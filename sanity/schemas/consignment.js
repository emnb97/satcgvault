/* ============================================================
   Arrival Ledger — a shipment record Omar manages himself.
   Appears in the Studio alongside Products.
   ============================================================ */
export default {
  name: "consignment",
  title: "Arrival Ledger",
  type: "document",
  fields: [
    {
      name: "ref", title: "Consignment reference", type: "string",
      description: 'Your shipment reference, e.g. "CN-2608".',
      validation: (R) => R.required()
    },
    {
      name: "date", title: "Date landed", type: "date",
      options: { dateFormat: "YYYY-MM-DD" },
      validation: (R) => R.required()
    },
    {
      name: "origin", title: "Origin", type: "string",
      description: 'Where it shipped from, e.g. "Tokyo" or "Osaka".',
      initialValue: "Tokyo"
    },
    {
      name: "lines", title: "Product lines", type: "number",
      description: "How many different sets were in this shipment.",
      validation: (R) => R.min(0)
    },
    {
      name: "cartons", title: "Cartons", type: "number",
      description: "Total cartons in the shipment.",
      validation: (R) => R.min(0)
    },
    {
      name: "note", title: "Note", type: "text", rows: 2,
      description: "What happened on the seal check. Shown on the site — keep it factual and reassuring.",
      validation: (R) => R.max(200)
    },
    {
      name: "image", title: "Arrival photograph", type: "image",
      options: { hotspot: true },
      description: "A photo of the shipment on arrival.",
      fields: [{ name: "alt", title: "Description", type: "string" }]
    },
    {
      name: "hidden", title: "Hide from the ledger", type: "boolean", initialValue: false,
      description: "Remove this record from the site without deleting it."
    }
  ],
  orderings: [
    { title: "Newest first", name: "dateDesc", by: [{ field: "date", direction: "desc" }] }
  ],
  preview: {
    select: { title: "ref", date: "date", origin: "origin", media: "image" },
    prepare: ({ title, date, origin, media }) => ({
      title: title || "(no ref)",
      subtitle: [date, origin].filter(Boolean).join(" · "),
      media
    })
  }
};
