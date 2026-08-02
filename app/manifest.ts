import type { MetadataRoute } from "next";

/**
 * Makes the app installable to the phone home screen. `display: standalone`
 * drops the browser chrome, which is what turns this from "a website I visit"
 * into something that opens like an app — and is why globals.css bothers to
 * contain overscroll and handle the safe-area insets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Command Center",
    short_name: "Command",
    description: "Personal AI operating system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Pinned to the computed value of --background in globals.css.
    background_color: "#080e15",
    theme_color: "#080e15",
    categories: ["productivity"],
    icons: [
      {
        src: "/icon.svg",
        // "any" is correct for a vector: it scales to whatever slot the OS
        // needs, so there's no set of raster sizes to enumerate.
        sizes: "any",
        type: "image/svg+xml",
        // The mark is drawn inside the centre 80%, so a circular Android
        // mask crops the padding rather than the artwork.
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Chat", short_name: "Chat", url: "/chat" },
      { name: "Tasks", short_name: "Tasks", url: "/tasks" },
      { name: "Inbox", short_name: "Inbox", url: "/inbox" },
    ],
  };
}
