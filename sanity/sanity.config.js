/* ============================================================
   Sanity Studio config — the interface Omar logs into.
   Products are drag-to-reorder; that order drives the catalogue.
   Deploy with:  npx sanity deploy   (from this /sanity folder)
   projectId is hardcoded (it is a public identifier, not a secret),
   so the config is valid regardless of environment variables.
   ============================================================ */
import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { orderableDocumentListDeskItem } from "@sanity/orderable-document-list";
import { schemaTypes } from "./schemas/index.js";

export default defineConfig({
  name: "satcgvault",
  title: "S&A TCG Vault",
  projectId: "fiay3p8h",
  dataset: "production",
  plugins: [
    structureTool({
      structure: (S, context) =>
        S.list()
          .title("Content")
          .items([
            orderableDocumentListDeskItem({ type: "product", title: "Products (drag to reorder)", S, context }),
            S.documentTypeListItem("consignment").title("Arrival Ledger")
          ])
    })
  ],
  schema: { types: schemaTypes }
});
