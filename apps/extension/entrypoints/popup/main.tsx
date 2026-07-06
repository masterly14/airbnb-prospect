import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { browser } from "wxt/browser"
import type { CrmGetConfigResponse } from "../../src/messages"
import "./styles.css"

function PopupApp() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [crmBaseUrl, setCrmBaseUrl] = useState("")

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: "CRM_GET_CONFIG" })
      .then((response: CrmGetConfigResponse) => {
        setConfigured(response.configured)
        setCrmBaseUrl(response.config?.crmBaseUrl ?? "")
      })
      .catch(() => setConfigured(false))
  }, [])

  async function openOptions() {
    await browser.runtime.sendMessage({ type: "CRM_OPEN_OPTIONS" })
    window.close()
  }

  async function openAirbnb() {
    await browser.tabs.create({ url: "https://www.airbnb.com.co/" })
    window.close()
  }

  return (
    <main className="popup">
      <p className="eyebrow">Airbnb CRM</p>
      <h1>CRM Alert</h1>
      <p className="description">
        La alerta aparece dentro de Airbnb en conversaciones, anuncios y perfiles. No se ejecuta en
        `chrome://extensions`.
      </p>

      <div className={`status ${configured ? "ok" : "warn"}`}>
        {configured === null
          ? "Revisando configuración..."
          : configured
            ? `Configurado: ${crmBaseUrl}`
            : "Falta configurar URL del CRM y token."}
      </div>

      <div className="actions">
        <button onClick={openOptions}>Configurar</button>
        <button className="secondary" onClick={openAirbnb}>
          Abrir Airbnb
        </button>
      </div>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<PopupApp />)
