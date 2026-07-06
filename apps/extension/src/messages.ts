import type { CreateManualLeadInput, CrmLead, LeadLookupMatch } from "@repo/crm-client"
import type { ExtensionConfig } from "./config"

export type CrmLookupRequest = {
  type: "CRM_LOOKUP"
  queries: string[]
}

export type CrmCreateRequest = {
  type: "CRM_CREATE"
  input: CreateManualLeadInput
}

export type CrmGetConfigRequest = {
  type: "CRM_GET_CONFIG"
}

export type CrmOpenOptionsRequest = {
  type: "CRM_OPEN_OPTIONS"
}

export type ExtensionRequest =
  | CrmLookupRequest
  | CrmCreateRequest
  | CrmGetConfigRequest
  | CrmOpenOptionsRequest

export type CrmLookupResponse =
  | {
      ok: true
      query: string | null
      matches: LeadLookupMatch[]
    }
  | {
      ok: false
      error: string
      status?: number
      needsConfig?: boolean
    }

export type CrmCreateResponse =
  | {
      ok: true
      lead: CrmLead
      created: boolean
    }
  | {
      ok: false
      error: string
      status?: number
      lead?: CrmLead
      needsConfig?: boolean
    }

export type CrmGetConfigResponse = {
  ok: true
  configured: boolean
  config?: Pick<ExtensionConfig, "crmBaseUrl">
}

export type CrmOpenOptionsResponse = {
  ok: true
}

export type ExtensionResponse =
  | CrmLookupResponse
  | CrmCreateResponse
  | CrmGetConfigResponse
  | CrmOpenOptionsResponse
