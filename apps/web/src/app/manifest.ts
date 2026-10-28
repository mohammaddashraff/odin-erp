import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AV8 ERP · ODIN Software Solutions",
    short_name: "AV8",
    description: "Student recruitment, admissions and academy operations",
    start_url: "/",
    display: "standalone",
    background_color: "#F4F7FC",
    theme_color: "#102747",
    icons: [
      {
        src: "/brand/oss-geometric-eye-transparent.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
