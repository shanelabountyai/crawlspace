import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { isPublicAddress } from "./ip";

export class SsrfError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;
/** Decides whether a resolved address may be contacted for a hostname. Default: public addresses only. */
export type AddressPolicy = (address: string, hostname: string) => boolean;

export const defaultResolver: Resolver = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);
export const defaultPolicy: AddressPolicy = (address) => isPublicAddress(address);

export interface GuardOptions {
  resolver?: Resolver;
  policy?: AddressPolicy;
}

/** Parse and vet a URL's scheme and host. Throws SsrfError; never connects. */
export function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("not a valid URL", raw);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError(`scheme ${url.protocol} is not allowed (http/https only)`, raw);
  if (url.username || url.password) throw new SsrfError("URLs with credentials are not allowed", raw);
  return url;
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

/**
 * Resolve the URL's host and refuse it unless every address passes the policy. Runs before any connection.
 * Returns the vetted addresses.
 */
export async function assertAllowed(raw: string, opts: GuardOptions = {}): Promise<string[]> {
  const url = parseTarget(raw);
  const host = hostOf(url);
  const policy = opts.policy ?? defaultPolicy;
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await (opts.resolver ?? defaultResolver)(host);
    } catch (e) {
      throw new SsrfError(`could not resolve ${host}: ${e instanceof Error ? e.message : String(e)}`, raw);
    }
  }
  if (addresses.length === 0) throw new SsrfError(`${host} has no addresses`, raw);
  const bad = addresses.find((a) => !policy(a, host));
  if (bad) throw new SsrfError(isIP(host) ? `${host} is a private, loopback, link-local or reserved address` : `${host} resolves to ${bad}, a private, loopback, link-local or reserved address`, raw);
  return addresses;
}

/**
 * net.connect-compatible lookup that re-checks addresses at connection time, so a DNS answer that changes
 * between the pre-check and the connect (DNS rebinding) is still refused.
 */
export function guardedLookup(opts: GuardOptions = {}): LookupFunction {
  const policy = opts.policy ?? defaultPolicy;
  const resolver = opts.resolver ?? defaultResolver;
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    resolver(hostname).then(
      (addresses) => {
        const bad = addresses.find((a) => !policy(a, hostname));
        if (addresses.length === 0 || bad) {
          const err = Object.assign(new SsrfError(`refused at connect: ${hostname} resolves to ${bad ?? "nothing"}`, hostname), { code: "ESSRF" });
          return callback(err);
        }
        const entries = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options?.all) callback(null, entries);
        else callback(null, entries[0]!.address, entries[0]!.family);
      },
      (e: unknown) => callback(e),
    );
  }) as unknown as LookupFunction;
}
