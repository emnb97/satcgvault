import { orderRankField } from "@sanity/orderable-document-list";
/* ============================================================
   Sanity schema — the vault catalogue.
   Omar edits here; the site rebuilds automatically on publish.
   ============================================================ */
export default {
  name: "product",
  title: "Product",
  type: "document",
  groups: [
    { name: "listing", title: "Listing", default: true },
    { name: "stock", title: "Stock & dispatch" },
    { name: "detail", title: "Details" }
  ],
  fields: [
    orderRankField({ type: "product" }),
    {
      name: "name", title: "Product name", type: "string", group: "listing",
      description: 'Set name only, e.g. "Storm Emeralda" — the type goes in the next field.',
      validation: (R) => R.required()
    },
    {
      name: "type", title: "Product type", type: "string", group: "listing",
      options: { list: ["Booster Box", "High Class Box", "Twin Set", "Special Set", "Display Case", "Accessory"] },
      initialValue: "Booster Box",
      validation: (R) => R.required()
    },
    {
      name: "slug", title: "Web address", type: "slug", group: "listing",
      options: { source: (doc) => `${doc.name} ${doc.type}`, maxLength: 96 },
      description: "Click Generate. Changing this after launch breaks any link already shared.",
      validation: (R) => R.required()
    },
    { name: "sku", title: "Internal code", type: "string", group: "listing", validation: (R) => R.required() },
    { name: "code", title: "Set code", type: "string", group: "listing", description: 'e.g. "M6", "SV11B"' },
    {
      name: "era", title: "Era", type: "string", group: "listing",
      options: { list: [
        "Base Set Era", "Gym Era", "Neo Era", "Legendary Collection",
        "e-Reader Era", "EX Era", "Diamond & Pearl Era", "Platinum Era",
        "HeartGold & SoulSilver Era", "Call of Legends", "Black & White Era",
        "XY Era", "Sun & Moon Era", "Sword & Shield Era", "Scarlet & Violet",
        "Mega Evolution Era", "Vault Line"
      ] },
      validation: (R) => R.required()
    },
    { name: "set", title: "Series", type: "string", group: "listing" },
    {
      name: "category", title: "Shop category", type: "string", group: "listing",
      options: { list: [
        { title: "Booster boxes", value: "booster-box" },
        { title: "Elite Trainer Boxes (ETB)", value: "etb" },
        { title: "Blister packs", value: "blister" },
        { title: "Single cards", value: "single" },
        { title: "Special & premium sets", value: "special" },
        { title: "Pre-orders", value: "preorder" },
        { title: "Vault accessories", value: "accessories" }
      ]},
      validation: (R) => R.required()
    },
    {
      name: "language", title: "Language", type: "string", group: "listing",
      options: { list: ["Japanese", "English", "N/A"] }, initialValue: "Japanese"
    },
    {
      name: "images", title: "Photographs", type: "array", group: "listing",
      of: [{ type: "image", options: { hotspot: true }, fields: [
        { name: "alt", title: "Description for screen readers and Google", type: "string" }
      ]}],
      validation: (R) => R.min(1).warning("Add at least one photograph before publishing.")
    },

    {
      name: "pricePence", title: "Price in pence", type: "number", group: "stock",
      description: "£95.00 is entered as 9500. Pence avoids rounding errors at checkout.",
      validation: (R) => R.required().integer().positive()
    },
    {
      name: "stock", title: "Stock on hand", type: "number", group: "stock",
      description: "Set to 0 to sell out a line without hiding it.",
      validation: (R) => R.required().integer().min(0)
    },
    {
      name: "availability", title: "Availability", type: "string", group: "stock",
      description: "Where this product shows. 'In the vault' = buyable now. 'Inbound' = pre-order, buyable. 'Comes through the vault' = shown on the collection page as a teaser, not buyable (for sets you source to order). 'Hidden' = off the site entirely.",
      options: { list: [
        { title: "In the vault (buyable now)", value: "stock" },
        { title: "Inbound (pre-order, buyable)", value: "inbound" },
        { title: "Comes through the vault (teaser only)", value: "sourced" },
        { title: "Hidden (off the site)", value: "hidden" }
      ]},
      initialValue: "stock",
      validation: (R) => R.required()
    },
    {
      name: "frozen", title: "Freeze this line", type: "boolean", group: "stock", initialValue: false,
      description: "Keeps the page live and indexed but stops anyone buying. Use during a stock count or a supplier dispute."
    },
    {
      name: "hidden", title: "Hide from the shop", type: "boolean", group: "stock", initialValue: false,
      description: "Removes it from the site entirely, including the sitemap."
    },
    { name: "preorder", title: "This is a pre-order", type: "boolean", group: "stock", initialValue: false },
    {
      name: "dispatch", title: "Dispatch line", type: "string", group: "stock",
      description: 'Shown on the product page, e.g. "Dispatch on or after 3 August 2026".',
      validation: (R) => R.required()
    },
    {
      name: "rarity", title: "Badge", type: "string", group: "stock",
      options: { list: [
        { title: "Standard", value: "vault" },
        { title: "Chase set (holo badge)", value: "holo" },
        { title: "Allocation", value: "allocation" }
      ]}, initialValue: "vault"
    },

    { name: "packs", title: "Packs per box", type: "number", group: "detail" },
    { name: "condition", title: "Condition", type: "string", group: "detail", initialValue: "Factory sealed" },
    { name: "sealed", title: "Factory sealed", type: "boolean", group: "detail", initialValue: true },
    { name: "weightGrams", title: "Shipping weight (g)", type: "number", group: "detail" },
    {
      name: "summary", title: "Short description", type: "text", rows: 3, group: "detail",
      description: "One or two sentences. Also used as the Google search description, so keep it under 155 characters.",
      validation: (R) => R.required().max(300)
    },
    { name: "detail", title: "Full description", type: "text", rows: 6, group: "detail" }
  ],
  preview: {
    select: { title: "name", subtitle: "type", media: "images.0", stock: "stock", frozen: "frozen" },
    prepare: ({ title, subtitle, media, stock, frozen }) => ({
      title: `${title} — ${subtitle}`,
      subtitle: frozen ? "FROZEN" : stock > 0 ? `${stock} in the vault` : "Sold out",
      media
    })
  }
};
