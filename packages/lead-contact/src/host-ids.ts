import type { PrismaClient } from '@repo/db'

export async function resolveCanonicalHostIds(
  db: PrismaClient,
  hostAirbnbId: string,
): Promise<string[]> {
  const ids = new Set<string>([hostAirbnbId])

  const aliases = await db.leadIdentityAlias.findMany({
    where: {
      OR: [{ aliasId: hostAirbnbId }, { canonicalId: hostAirbnbId }],
    },
  })

  for (const alias of aliases) {
    ids.add(alias.aliasId)
    ids.add(alias.canonicalId)
  }

  return [...ids]
}
