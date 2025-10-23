// live laugh love stackoverflow :D
function countryCodeToFlag(countryCode?: string) {
    // Validate the input to be exactly two characters long and all alphabetic
    if (!countryCode || countryCode.length !== 2 || !/^[a-zA-Z]+$/.test(countryCode)) {
        return '🏳️'; // White Flag Emoji for unknown or invalid country codes
    }

    // Convert the country code to uppercase to match the regional indicator symbols
    const code = countryCode.toUpperCase();

    // Calculate the offset for the regional indicator symbols
    const offset = 127397;

    // Convert each letter in the country code to its corresponding regional indicator symbol
    const flag = Array.from(code).map(letter => String.fromCodePoint(letter.charCodeAt(0) + offset)).join('');

    return flag;
}
// end stack overflow code

import type { AllMiddlewareArgs, SlackCommandMiddlewareArgs, StringIndexed } from "@slack/bolt";
import type { Block, KnownBlock, UsersInfoResponse } from "@slack/web-api";
import { sendGET } from "../../utils";
import sql from "../../postgres";

// Only using the types we need.
type OsuProfile = {
    id: number,
    username: string,
    avatar_url: string,
    country_code: string,
    playmode: 'osu' | 'taiko' | 'fruits' | 'mania',
    statistics: {
        pp: number,
        country_rank?: number,
        global_rank?: number,
    },
    statistics_rulesets: Record<'osu' | 'taiko' | 'fruits' | 'mania', {
        pp: number
    }>
}

async function generateProfile(opts: { slackProfile?: UsersInfoResponse['user'], osuId?: string | number, osuUsername?: string, osuProfile?: { linked: true } & OsuProfile }): Promise<(Block | KnownBlock)[]> {
    const osuProfile: { linked: true } & OsuProfile | { linked: false } = opts.osuProfile ?? await (async () => {
        if (opts.osuId) return {
            linked: true,
            ...(await sendGET<OsuProfile>(`/users/${opts.osuId}?key=id`))
        }

        else if (opts.osuUsername) return {
            linked: true,
            ...(await sendGET<OsuProfile>(`/users/@${opts.osuUsername}?key=username`))
        }

        else return {
            linked: false
        }
    })();

    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*Slack Username*: ${opts.slackProfile ? `<https://my.slack.com/team/${opts.slackProfile.id}|${opts.slackProfile.profile!.display_name_normalized}>` : `*Not linked*`}
                        *osu! username:* ${osuProfile.linked ? `<https://osu.ppy.sh/users/${osuProfile.id}|${osuProfile.username}>` : `*Not linked*`}
                        
                        *osu! user data*:
                        - *default/favorite ruleset*: ${osuProfile.linked ? { osu: ":osu-standard: osu!standard", taiko: ":osu-taiko: osu!taiko", fruits: ":osu-catch: osu!catch", mania: ":osu-mania: osu!mania"}[osuProfile.playmode] : `Not linked`}
                        - *pp:* ${osuProfile.linked ? Math.floor(osuProfile.statistics.pp).toLocaleString() : `Not linked`}
                        - *global rank:* ${osuProfile.linked ? (osuProfile.statistics.global_rank ? `#\u200B${osuProfile.statistics.global_rank.toLocaleString()}` : `No global rank`) : `Not linked`}
                        - ${countryCodeToFlag(osuProfile.linked ? osuProfile.country_code : undefined)} *country rank:* ${osuProfile.linked ? (osuProfile.statistics.country_rank ? `#\u200B${osuProfile.statistics.country_rank.toLocaleString()}` : `No country rank`) : `Not linked`}
                        `.split('\n').map(x => x.trim()).join('\n')
            },
            "accessory": {
                "type": "image",
                "image_url": osuProfile.linked ? osuProfile.avatar_url : 'https://osu.ppy.sh/images/layout/avatar-guest@2x.png',
                "alt_text": osuProfile.linked ? `${osuProfile.username}'s osu! profile picture` : `default osu! profile picture`
            }
        },
        ...(osuProfile.linked ? [{
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    action_id: 'noop',
                    url: `osu://u/${osuProfile.id}`,
                    text: {
                        type: 'plain_text',
                        text: 'View user in osu!lazer',
                    }
                }
            ]
        }] as (KnownBlock | Block)[] : [])
    ]
}

export default async function ProfileCommand(ctx: SlackCommandMiddlewareArgs & AllMiddlewareArgs<StringIndexed>) {
    await ctx.ack({ response_type: 'in_channel' });

    const arg = ctx.command.text.slice();

    let match;

    if (match = arg.match(/\<\@(.+)\|(.+)>/)) {
        // Slack user
        const userId = match[1]!;
        const slackProfile = (await ctx.client.users.info({ user: userId })).user!;

        const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE slack_id = ${userId}`;

        await ctx.respond({
            response_type: 'in_channel',
            text: `<@${ctx.body.user_id}> ran \`/osu-profile\``,
            blocks: await generateProfile({ slackProfile, osuId: userLink[0]?.osu_id })
        })
    } else if (arg) {
        // osu! user
        const user = await sendGET<OsuProfile & { error: any }>(`/users/@${arg}?key=username`);

        if (user && user.error == undefined) {
            const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE osu_id = ${user.id}`;

            if (userLink[0]) {
                const slackProfile = (await ctx.client.users.info({ user: userLink[0].slack_id })).user!;

                await ctx.respond({
                    response_type: 'in_channel',
                    text: `<@${ctx.body.user_id}> ran \`/osu-profile\``,
                    blocks: await generateProfile({ slackProfile, osuProfile: { linked: true, ...user } })
                })
            } else {
                await ctx.respond({
                    response_type: 'in_channel',
                    text: `<@${ctx.body.user_id}> ran \`/osu-profile\``,
                    blocks: await generateProfile({ osuProfile: { linked: true, ...user } })
                })
            }
        } else {
            await ctx.respond({
                response_type: 'in_channel',
                text: `<@${ctx.body.user_id}> ran \`/osu-profile\``,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `:warning: I couldn't find an osu! user with the username \`${arg}\`.`
                        }
                    }
                ]
            })
        }
    } else {
        // User's own profile
        const userId = ctx.body.user_id;
        const slackProfile = (await ctx.client.users.info({ user: userId })).user!;

        const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE slack_id = ${userId}`;

        await ctx.respond({
            response_type: 'in_channel',
            text: `<@${ctx.body.user_id}> ran \`/osu-profile\``,
            blocks: await generateProfile({ slackProfile, osuId: userLink[0]?.osu_id })
        })
    }
}