import { prisma } from "./prisma"


async function main() {
  const games = await prisma.game.findMany({
    where: { loserId: null },
    include: { players: true }
  })

  console.log(`Found ${games.length} games to backfill`)

  for (const game of games) {
    const loser = game.players.find(p => p.id !== game.winnerId)
    if (!loser) continue
    await prisma.game.update({
      where: { id: game.id },
      data: { loserId: loser.id }
    })
  }
}

main().finally(() => prisma.$disconnect())