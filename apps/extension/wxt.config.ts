import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  dev: {
    server: {
      // El dashboard (Next.js) usa el 3000; sin esto WXT captura localhost:3000
      // y las llamadas al CRM devuelven 404.
      port: 3117,
    },
  },
  manifest: {
    name: "Airbnb CRM Alert",
    description: "Valida si un anfitrión o conversación de Airbnb ya existe en el CRM.",
    action: {
      default_title: "Airbnb CRM Alert",
    },
    permissions: ["storage", "tabs"],
    host_permissions: [
      "https://www.airbnb.com.co/*",
      "https://www.airbnb.com/*",
      "http://localhost:3000/*",
      "https://*.vercel.app/*",
    ],
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  },
})
