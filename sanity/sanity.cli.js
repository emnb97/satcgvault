/* Sanity CLI settings. projectId is a public identifier, not a secret
   (it's also in sanity.config.js), so this file is committed. */
import { defineCliConfig } from "sanity/cli";
export default defineCliConfig({ api: { projectId: "fiay3p8h", dataset: "production" } });
