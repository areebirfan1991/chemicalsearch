import { createFileRoute } from "@tanstack/react-router";
import ChemSearch from "@/components/ChemSearch";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chem Search — Search import records across spreadsheets" },
      { name: "description", content: "Upload Excel files and instantly search chemical import records by GD number, item, importer, supplier and more." },
      { property: "og:title", content: "Chem Search" },
      { property: "og:description", content: "Upload Excel files and instantly search chemical import records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChemSearch,
});
