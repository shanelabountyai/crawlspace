import Link from "next/link";
import { BRAND } from "@/lib/report/brand";

/** Lab Intelligence branding on the report page (D-33). */
export function BrandHeader() {
  return (
    <header className="brand-bar" data-testid="brand-header">
      <Link href="/" className="brand-mark">
        {BRAND.product}
      </Link>
      <span className="brand-by">{BRAND.by}</span>
    </header>
  );
}

export function BrandFooter() {
  return (
    <footer className="brand-footer" data-testid="brand-footer">
      <p>
        {BRAND.product} is built by {BRAND.company}. {BRAND.address}
      </p>
    </footer>
  );
}
