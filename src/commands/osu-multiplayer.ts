import type { AllMiddlewareArgs, SlackCommandMiddlewareArgs, StringIndexed } from "@slack/bolt";
import sql from "../../postgres";
import { sendGET } from "../../utils";
import type { Block, KnownBlock } from "@slack/web-api";

import { multiLobbyTask } from "../../cron";

export default async function MultiplayerCommand(ctx: SlackCommandMiddlewareArgs & AllMiddlewareArgs<StringIndexed>) {
    ctx.ack();

    const userLink = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users WHERE slack_id = ${ctx.body.user_id}`;

    if (!userLink[0]) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `:warning: *Hey <${ctx.body.user_id}>!* You haven't linked your osu! account yet. Head over to https://${process.env.NGROK_DOMAIN && process.env.NODE_ENV == 'development' ? process.env.NGROK_DOMAIN : 'osu.dino.icu'}/link to do that.`
        })
    };

    // Only typing the stuff we ACTUALLY need. It'd be too painful to type the entire multiplayer room structure.
    const rooms = await sendGET<{
        id: number,
        name: string,
        starts_at: string,
        has_password: boolean,
        recent_participants: {
            avatar_url: string,
            id: number,
            username: string
        }[]
    }[]>('/rooms?type_group=realtime&mode=active&limit=1000');

    const room = rooms.find((room) => room.recent_participants.some((user) => user.id.toString() == userLink[0]!.osu_id))

    if (!room) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `:warning: *Hey <${ctx.body.user_id}>!* Looks like you aren't in a multiplayer lobby. Join one, and then I can start inviting people!`
        })
    };

    const osuUsers = room.recent_participants

    const users = await sql.unsafe<{ osu_id: string, slack_id: string }[]>(`
    SELECT 
        u.osu_id,
        us.slack_id
    FROM 
        UNNEST(ARRAY${JSON.stringify(osuUsers.map(x => x.id.toString())).replaceAll('"', "'")}) AS u(osu_id)
    LEFT JOIN 
        users us ON us.osu_id = u.osu_id
    `)

    const call = await ctx.client.calls.add({
        external_unique_id: room.id.toString(),
        join_url: `https://${process.env.NGROK_DOMAIN && process.env.NODE_ENV == 'development' ? process.env.NGROK_DOMAIN : 'osu.rana.hackclub.app'}/multi-lobby-join?id=${room.id}`,
        desktop_app_join_url: 'osu://room/' + room.id,
        date_start: (new Date(room.starts_at)).getTime() / 1000,
        title: room.name,
        created_by: ctx.body.user_id,
        external_display_id: room.id.toString(),
        users: users.map(x => x.slack_id ? ({ slack_id: x.slack_id }) : ({
            external_id: x.osu_id.toString(),
            display_name: osuUsers.find(user => user.id.toString() == x.osu_id)?.username!,
            avatar_url: osuUsers.find(user => user.id.toString() == x.osu_id)?.avatar_url
        }))
    });

    await sql`INSERT INTO multi_lobby VALUES (${room.id}, ${call.call!.id!})`;

    const blocks: (Block | KnownBlock)[] = [
        {
            type: "section",
            text: {
                type: 'mrkdwn',
                text: `<@${ctx.body.user_id}> shared an osu! multiplayer lobby.`
            }
        },
        {
            type: "call",
            // @ts-expect-error Apparently Bolt doesn't know calls exist. That's fun.
            call_id: call.call!.id,
        }
    ];

    if (room.has_password) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'This room is *:lock: password protected!* Ask for the password if you want to join.'
            }
        })
    }

    ctx.respond({
        response_type: "in_channel",
        text: "An osu! multiplayer lobby was shared",
        blocks
    });

    if (multiLobbyTask.getStatus() == 'stopped') {
        multiLobbyTask.start()
    }

    // ctx.client.calls.end({ id: call.call!.id! })
}