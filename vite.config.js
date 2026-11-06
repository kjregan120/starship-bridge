import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The site is served from kjregan120.github.io/starship-bridge/.
  base: "/starship-bridge/",
  plugins: [react()]
  // Phase later: add a `server.proxy` entry here (or a Vite middleware) to
  // forward /api/* to your local key-holding proxy during development, then
  // to the Cloudflare Worker in production.
});
