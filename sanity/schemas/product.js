import { orderRankField } from "@sanity/orderable-document-list";

/* Which shop categories make sense for each product type. Sanity shows a
   warning (not a block) when they don't match — e.g. a single card filed
   under accessories. Keep in step with TYPE_CATEGORIES in scripts/catalogue.mjs. */
const TYPE_CATEGORIES = {
  "Booster Box": ["booster-box", "special", "preorder"],
  "High Class Box": ["booster-box", "special", "preorder"],
  "Elite Trainer Box": ["etb", "preorder"],
  "Blister Pack": ["blister", "preorder"],
  "Single Card": ["single"],
  "Twin Set": ["special", "preorder"],
  "Special Set": ["special", "preorder"],
  "Mystery Pouch": ["special", "preorder"],
  "Display Case": ["accessories"],
  "Accessory": ["accessories"]
};
const NO_SET = ["Display Case", "Accessory"];
const needsSet = (label) => (R) => R.custom((value, { document }) =>
  value || NO_SET.includes(document?.type) ? true : `Add the ${label} — it shows on the product page.`).warning();
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
      options: { list: ["Booster Box", "High Class Box", "Elite Trainer Box", "Blister Pack", "Single Card", "Twin Set", "Special Set", "Mystery Pouch", "Display Case", "Accessory"] },
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
    { name: "code", title: "Set code", type: "string", group: "listing", description: 'e.g. "M6", "SV11B". Leave blank only for accessories.', validation: needsSet("set code") },
    {
      name: "era", title: "Era", type: "string", group: "listing",
      options: { list: [
        "Base Set Era", "Gym Era", "Neo Era", "Legendary Collection",
        "e-Reader Era", "EX Era", "Diamond & Pearl Era", "Platinum Era",
        "HeartGold & SoulSilver Era", "Call of Legends", "Black & White Era",
        "XY Era", "Sun & Moon Era", "Sword & Shield Era", "Scarlet & Violet",
        "Mega Evolution Era",
        "30th Celebration", "Mystery Pouches", "Chinese",
        "Vault Line"
      ] },
      description: "How customers browse to it in the menu. Pick the line it belongs to — set Product type and Shop category below as normal, so a 30th Celebration booster box still shows under Booster Boxes too.",
      validation: (R) => R.required()
    },
    { name: "set", title: "Series", type: "string", group: "listing", validation: needsSet("series") },
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
      validation: (R) => [
        R.required(),
        R.custom((value, { document }) => {
          const ok = TYPE_CATEGORIES[document?.type];
          if (!value || !ok || ok.includes(value)) return true;
          return `A "${document.type}" doesn't usually belong here — check the shop category.`;
        }).warning()
      ]
    },
    {
      name: "language", title: "Language", type: "string", group: "listing",
      options: { list: ["Japanese", "English", "Chinese", "N/A"] }, initialValue: "Japanese",
      validation: (R) => R.required()
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
      /* Field name kept as "stock" so no data migration is needed.
         Live stock lives in Postgres; this only seeds a brand-new line. */
      name: "stock", title: "Opening stock (new lines only)", type: "number", group: "stock",
      description: "Used once, the first time this line goes on sale. After that the live count is kept on the Stock desk (satcgvault.co.uk/vault-desk.html) and goes down by itself as orders are paid — changing this number does nothing for a line that's already selling. To stop sales, use Freeze below.",
      initialValue: 0,
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
    /* No stock number here: Sanity's figure is only the opening stock,
       and showing it would contradict the live count on the Stock desk. */
    select: { title: "name", subtitle: "type", media: "images.0", frozen: "frozen", availability: "availability" },
    prepare: ({ title, subtitle, media, frozen, availability }) => ({
      title: `${title} — ${subtitle}`,
      subtitle: frozen ? "FROZEN" : ({ stock: "In the vault", inbound: "Inbound (pre-order)", sourced: "Teaser only", hidden: "Hidden" })[availability] || "",
      media
    })
  }
};
