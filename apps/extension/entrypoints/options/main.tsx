import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { browser } from "wxt/browser"
import { isValidCrmBaseUrl, normalizeCrmBaseUrl, type ExtensionConfig } from "../../src/config"
import type { CrmLookupResponse } from "../../src/messages"
import { getStoredConfig, saveStoredConfig } from "../../src/background/settings"
import "./styles.css"

function OptionsApp() {
  const [crmBaseUrl, setCrmBaseUrl] = useState("")
  const [dashboardToken, setDashboardToken] = useState("")
  const [status, setStatus] = useState<string>("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    void getStoredConfig().then((config) => {
      setCrmBaseUrl(config?.crmBaseUrl ?? "")
      setDashboardToken(config?.dashboardToken ?? "")
    })
  }, [])

  async function handleSave(): Promise<boolean> {
    const config: ExtensionConfig = {
      crmBaseUrl: normalizeCrmBaseUrl(crmBaseUrl),
      dashboardToken: dashboardToken.trim(),
    }

    if (!isValidCrmBaseUrl(config.crmBaseUrl)) {
      setStatus("La URL del CRM debe comenzar con http:// o https://.")
      return false
    }
    if (!config.dashboardToken) {
      setStatus("El dashboard token es obligatorio.")
      return false
    }

    setPending(true)
    setStatus("")
    try {
      await saveStoredConfig(config)
      setStatus("Configuración guardada.")
      return true
    } finally {
      setPending(false)
    }
  }

  async function handleTest() {
    const saved = await handleSave()
    if (!saved) return
    setPending(true)
    try {
      const response = (await browser.runtime.sendMessage({
        type: "CRM_LOOKUP",
        queries: ["airbnb-crm-extension-test"],
      })) as CrmLookupResponse

      setStatus(response.ok ? "Conexión OK con el CRM." : `No se pudo conectar: ${response.error}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="options-shell">
      <section className="card">
        <p className="eyebrow">Airbnb CRM Alert</p>
        <h1>Configuración de CRM</h1>
        <p className="description">
          Guarda la URL del dashboard y el token compartido para validar prospectos desde Airbnb.
        </p>

        <label>
          URL del CRM
          <input
            placeholder="http://localhost:3000"
            value={crmBaseUrl}
            onChange={(event) => setCrmBaseUrl(event.target.value)}
          />
        </label>

        <label>
          Dashboard token
          <input
            placeholder="DASHBOARD_TOKEN"
            type="password"
            value={dashboardToken}
            onChange={(event) => setDashboardToken(event.target.value)}
          />
        </label>

        <div className="actions">
          <button disabled={pending} onClick={handleSave}>
            Guardar
          </button>
          <button className="secondary" disabled={pending} onClick={handleTest}>
            Probar conexión
          </button>
        </div>

        {status ? <p className="status">{status}</p> : null}
      </section>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<OptionsApp />)
