import type { AllMiddlewareArgs, SlackCommandMiddlewareArgs, StringIndexed } from "@slack/bolt";
import sql from "../../postgres";
import { rulesetToEmoji, sendGET } from "../../utils";

type OsuScore = {
    id: number;
    accuracy: number;
    created_at: string;
    max_combo: number;
    mode: "osu" | "taiko" | "fruits" | "mania";
    mode_int: number;
    mods: string[];
    pp: number;
    rank: string;
    statistics: {
        count_300: number;
        count_100: number;
        count_50: number;
        count_miss: number;
    };
    beatmap: {
        id: number;
        version: string;
        difficulty_rating: number;
        url: string;
    }
    beatmapset: {
        artist: string;
        artist_unicode: string;
        title: string;
        title_unicode: string;
        covers: {
            card: string;
            "card@2x": string;
        },
    },
    user: {
        id: number;
        username: string;
    }
}

async function findLastScore(osuId: string) {
    if (!osuId) return null;

    const scores = await Promise.all([
        sendGET<OsuScore[]>(`/users/${osuId}/scores/recent?legacy_only=0&include_fails=0&mode=osu&limit=1`),
        sendGET<OsuScore[]>(`/users/${osuId}/scores/recent?legacy_only=0&include_fails=0&mode=taiko&limit=1`),
        sendGET<OsuScore[]>(`/users/${osuId}/scores/recent?legacy_only=0&include_fails=0&mode=fruits&limit=1`),
        sendGET<OsuScore[]>(`/users/${osuId}/scores/recent?legacy_only=0&include_fails=0&mode=mania&limit=1`),
    ]);

    const allScores = scores.flat();

    const lastScore = allScores.reduce((latest, score) => {
        if (!latest) return score;
        return Date.parse(score.created_at) > Date.parse(latest.created_at) ? score : latest;
    }, null as OsuScore | null);

    return lastScore;
}

async function generateLastPlayedMessage(score: OsuScore | null, slackId?: string) {
    if (!score) {
        return [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `:warning: No recent scores found for that user.`
                }
            }
        ]
    }

    const ruleset = rulesetToEmoji(score.mode_int, true);
    const date = new Date(score.created_at);

    return [
        {
            type: "card",
            hero_image: {
                type: "image",
                image_url: score.beatmapset.covers["card@2x"],
                alt_text: `Cover image for ${score.beatmapset.artist} - ${score.beatmapset.title}`
            },
            title: {
                type: "mrkdwn",
                text: `${ruleset.split(" ")[0]!} ${score.beatmapset.artist} - ${score.beatmapset.title} (${score.beatmap.version} - ${score.beatmap.difficulty_rating.toFixed(2)}*)`,
                verbatim: false
            },
            subtitle: {
                type: "mrkdwn",
                text: `played by ${slackId ? `<@${slackId}>` : score.user.username} <!date^${Math.floor(date.getTime() / 1000)}^{ago}|${date.toLocaleString()}>`,
                verbatim: false
            },
            body: {
                type: "mrkdwn",
                text: `:osu-score-300: ${score.statistics.count_300} :osu-score-100: ${score.statistics.count_100} :osu-score-50: ${score.statistics.count_50} :osu-score-miss: ${score.statistics.count_miss}\n*pp*: ${score.pp.toFixed(2)}pp`,
                verbatim: false
            },
            subtext: {
                type: "mrkdwn",
                text: `${ruleset} | Mods: ${score.mods.join(", ") || "None"} | ${(score.accuracy * 100).toFixed(2)}% | ${score.max_combo}x | ${score.rank}`,
                verbatim: false
            },
            actions: [
                ...(score.mode === "osu" ? [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Generate Video",
                            emoji: false
                        },
                        action_id: "generate_replay",
                        value: score.id.toString(),
                    }] : []
                ),
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "Download Replay File",
                        emoji: false
                    },
                    action_id: "noop",
                    url: `https://osu.ppy.sh/scores/osu/${score.id}/download`,
                    value: score.id.toString()
                }
            ]
        }
    ]
}

export default async function LastPlayed(ctx: SlackCommandMiddlewareArgs & AllMiddlewareArgs<StringIndexed>) {
    const arg = ctx.command.text.slice();

    let match;

    if (match = arg.match(/\<\@(.+)\|(.+)>/)) {
        // Slack user
        const userId = match[1]!;

        const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE slack_id = ${userId}`;

        const osuId = userLink[0]?.osu_id;

        if (osuId) {
            const lastScore = await findLastScore(osuId);

            await ctx.ack({
                response_type: 'in_channel',
                text: `<@${ctx.body.user_id}> ran \`/osu-lastplayed\``,
                blocks: await generateLastPlayedMessage(lastScore, userId)
            })
        } else {
            await ctx.ack({
                response_type: 'in_channel',
                text: `<@${ctx.body.user_id}> ran \`/osu-lastplayed\``,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `:warning: <@${userId}> doesn't have an osu! account linked.`
                        }
                    }
                ]
            })
        }
    } else if (arg) {
        // osu! user
        const user = await sendGET<{ id: string, error?: any }>(`/users/@${arg}?key=username`);

        if (user && user.error == undefined) {
            const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE osu_id = ${user.id}`;
            const lastScore = await findLastScore(user.id.toString());

            await ctx.ack({
                response_type: 'in_channel',
                text: `<@${ctx.body.user_id}> ran \`/osu-lastplayed\``,
                blocks: await generateLastPlayedMessage(lastScore, userLink[0]?.slack_id)
            })
        } else {
            await ctx.ack({
                response_type: 'in_channel',
                text: `<@${ctx.body.user_id}> ran \`/osu-lastplayed\``,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `:warning: I couldn't find an osu! player with the username \`${arg}\`.`
                        }
                    }
                ]
            })
        }
    } else {
        // User's own profile
        const userId = ctx.body.user_id;

        const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE slack_id = ${userId}`;

        if (!userLink[0]) {
            return await ctx.ack({
                response_type: 'ephemeral',
                text: `:warning: You don't have an osu! account linked. Use \`/osu-link\` to link your osu! account.`
            })
        }

        const osuId = userLink[0].osu_id;
        const lastScore = await findLastScore(osuId);

        await ctx.ack({
            response_type: 'in_channel',
            text: `<@${ctx.body.user_id}> ran \`/osu-lastplayed\``,
            blocks: await generateLastPlayedMessage(lastScore, userId)
        })
    }
}