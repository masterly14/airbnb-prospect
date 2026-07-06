import OpenAI from 'openai'
import type { z } from 'zod'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('Missing DEEPSEEK_API_KEY in environment')
    }
    client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    })
  }
  return client
}

export async function completeJson<T extends z.ZodType>(
  systemPrompt: string,
  userPrompt: string,
  schema: T,
): Promise<z.infer<T>> {
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
  const openai = getClient()

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('Empty response from Deepseek')
  }

  const parsed = JSON.parse(content)
  return schema.parse(parsed)
}

export { completeJson as default }
