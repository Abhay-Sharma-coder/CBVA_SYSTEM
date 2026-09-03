import type { Metadata } from "next";
import { PhaseStub } from "@/components/app-shell/phase-stub";

export const metadata: Metadata = { title: "Floor Map" };

export default function Page() {
  return (
    <PhaseStub
      title="Floor Map"
      phase={2}
      summary="The interactive plan of Floor 4. Pick a bay, pick a desk, book a slot."
      willInclude={[
        "Real seat coordinates extracted from the Neetaara CAD drawing, replacing the temporary grid",
        "Pan and zoom over walls, columns and glazing rendered from the CAD layers",
        "Live seat status using the vocabulary on the style guide",
        "Filter by zone, bay, amenity and by who is sitting where",
      ]}
    />
  );
}
