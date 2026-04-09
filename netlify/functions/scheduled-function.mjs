// YOUR_BASE_DIRECTORY/netlify/functions/test-scheduled-function.mjs

export default async (req) => {
    const { next_run } = await req.json()

    console.log("Received event! Next invocation at:", next_run)
}

export const config = {
    //schedule: "@hourly"
    schedule: "*/30 13-22 * * 1-5"
}

// Cron: a cada 30 min, das 13h às 22h UTC (10h às 19h Brasília), Seg a Sex
// schedule: "*/30 13-22 * * 1-5"
