import type { AllMiddlewareArgs, SlackCommandMiddlewareArgs, StringIndexed } from "@slack/bolt";
import type { UsersInfoResponse } from "@slack/web-api";
import { sendGET } from "../../utils";
import sql from "../../postgres";

async function generateProfile(opts: { slackProfile: UsersInfoResponse['user'], osuId?: string | number, osuUsername?: string, osuProfile?: { linked: true, id: number, username: string, avatar_url: string } }) {
    const osuProfile: { linked: true, id: number, username: string, avatar_url: string } | { linked: false } = opts.osuProfile ?? await (async () => {
        if (opts.osuId) return {
            linked: true,
            ...(await sendGET<{
                id: number,
                username: string,
                avatar_url: string
            }>(`/users/${opts.osuId}?key=id`))
        }

        else if (opts.osuUsername) return {
            linked: true,
            ...(await sendGET<{
                id: number,
                username: string,
                avatar_url: string
            }>(`/users/${opts.osuUsername}?key=username`))
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
                "text": `*Slack Username*: ${opts.slackProfile ? `<https://hackclub.slack.com/team/${opts.slackProfile.id}|${opts.slackProfile.profile!.display_name_normalized}>` : `**Not linked**`}\n*osu! username:* ${osuProfile.linked ? `<https://osu.ppy.sh/users/${osuProfile.id}|${osuProfile.username}` : `**Not linked**`}>`
            },
            "accessory": {
                "type": "image",
                "image_url": osuProfile.linked ? osuProfile.avatar_url : 'https://osu.ppy.sh/images/layout/avatar-guest@2x.png',
                "alt_text": osuProfile.linked ? `${osuProfile.username}'s osu! profile picture` : `default osu! profile picture`
            }
        }
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
        const user = await sendGET<{ id: number, username: string, avatar_url: string }>(`/users/${arg}?key=username`);


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