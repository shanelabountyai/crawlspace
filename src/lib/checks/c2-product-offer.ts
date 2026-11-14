import { PRODUCT_TYPES } from "../sitetype";
import { completeness, offerField } from "./completeness";
import type { CheckDefinition } from "./types";

export const c2ProductOffer: CheckDefinition = {
  id: "C2",
  category: "C",
  title: "Product and Offer data is complete",
  appliesTo: ["ecommerce"],
  run(ctx) {
    return completeness(ctx.keyPages, PRODUCT_TYPES.filter((t) => t.startsWith("Product")), "Product", {
      name: (n) => n.name,
      price: offerField("price", "lowPrice"),
      priceCurrency: offerField("priceCurrency"),
      availability: offerField("availability"),
    });
  },
};
