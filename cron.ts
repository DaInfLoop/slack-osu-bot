// LLM GENERATED CODE
function arraysEqualUnordered<T>(a: T[], b: T[]) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, i) => val === sortedB[i]);
}
// END LLM GENERATED CODE

import cron from "node-cron";
import { sendGET, Mods } from "./utils";
import sql from "./postgres";
import { WebClient } from "@slack/web-api";

const client = new WebClient(process.env.BOT_TOKEN);

export const multiLobbyTask = cron.createTask('*/5 * * * *', async (ctx) => {
    // This ENTIRE thing is held together by hopes and dreams. It _will_ break.
    try {
        const activeRooms = await sql<{ lobby_id: number, slack_call_id: string }[]>`SELECT * FROM multi_lobby;`;

        if (!activeRooms[0]) {
            // There are no active rooms. Cancel the cron task until there is one.
            multiLobbyTask.stop()
            return;
        }

        // Only typing the stuff we ACTUALLY need. It'd be too painful to type the entire multiplayer room structure.
        const response = await sendGET<{
            id: number,
            name: string,
            starts_at: string,
            recent_participants: {
                avatar_url: string,
                id: number,
                username: string
            }[]
        }[]>('/rooms?type_group=realtime&mode=active&limit=1000');

        for (const room of activeRooms) {
            try {
                const osuRoom = response.find(r => r.id === room.lobby_id);

                if (!osuRoom) {
                    await client.calls.end({
                        id: room.slack_call_id
                    });

                    await sql`DELETE FROM rooms WHERE slack_call_id = ${room.slack_call_id};`;
                    continue
                } else {
                    const callInfo = await client.calls.info({ id: room.slack_call_id });

                    if (!callInfo.call) continue; // idk what's happened here then.

                    if (callInfo.call.title !== osuRoom.name) {
                        client.calls.update({
                            id: room.slack_call_id,
                            title: osuRoom.name
                        })
                    }

                    const callUsers = callInfo.call.users!;

                    const callUsersIds = callUsers.map(x => x.external_id!);

                    const osuRoomIds = osuRoom.recent_participants.map(user => user.id.toString());

                    if (!arraysEqualUnordered(callUsersIds, osuRoomIds)) {
                        const removed = Array.from(new Set(callUsersIds.filter(u => !osuRoomIds.includes(u!))));
                        const added = Array.from(new Set(osuRoomIds.filter(u => !callUsersIds.includes(u))));

                        if (removed.length) {
                            client.calls.participants.remove({
                                id: room.slack_call_id,
                                users: removed.map(r => ({
                                    external_id: r,
                                    display_name: callUsers.find(u => u.external_id == r)!.display_name!,
                                    avatar_url: callUsers.find(u => u.external_id == r)!.avatar_url!,                                    
                                }))
                            })
                        }

                        if (added.length) {
                            client.calls.participants.add({
                                id: room.slack_call_id,
                                users: added.map(a => ({
                                    external_id: a,
                                    display_name: osuRoom.recent_participants.find(u => u.id.toString() == a)!.username!,
                                    avatar_url: osuRoom.recent_participants.find(u => u.id.toString() == a)!.avatar_url!, 
                                }))
                            })
                        }
                    }
                }
            } catch (err) {
                console.log(err)
            }
        }
    } catch (err) {
        console.error(err)
    }
});

(async () => {
    const totalActiveRooms = await sql<{ count: number }[]>`SELECT COUNT(*) FROM multi_lobby;`;

    if (totalActiveRooms[0] && totalActiveRooms.count !== 0) {
        multiLobbyTask.start();
        multiLobbyTask.execute();
    } else {
        console.log('[DEBUG]', 'we have no active rooms')
    }
})();

const t = cron.schedule('5 5 0 * * *', async function dailyChallenge() {
    const response = await sendGET<{
        id: number,
        name: string,
        host: {
            id: number,
            avatar_url: string,
            username: string
        },
        current_playlist_item: {
            id: number,
            beatmap_id: number,
            required_mods: { acronym: string, settings: {} }[],
            ruleset_id: 0 | 1 | 2 | 3,
            beatmap: {
                id: number,
                difficulty_rating: number,
                beatmapset_id: number,
                mode: 'osu' | 'taiko' | 'fruits' | 'mania',
                beatmapset: {
                    title: string,
                    artist: string
                }
            }
        }
    }[]>('/rooms?type_group=playlists&mode=active&limit=1000');

    const dailyChallenge = response.find(playlist => playlist.host.id == 3);

    if (!dailyChallenge) // What.
        return;

    // This is usually ALWAYS osu!std, but one time it was osu!taiko and I don't want stuff to break in case it happens again.
    const ruleset = [":osu-standard: osu!standard", ":osu-taiko: osu!taiko", ":osu-catch: osu!catch", ":osu-mania: osu!mania"][dailyChallenge.current_playlist_item.ruleset_id]!;

    const item = dailyChallenge.current_playlist_item;

    client.chat.postMessage({
        channel: 'C165V7XT9', // #osu
        text: `A new daily challenge has started!`,
        blocks: [
            {
                type: 'header',
                text: {
                    text: ruleset.split(' ').shift() + " A new daily challenge has started!",
                    emoji: true,
                    type: "plain_text"
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `<https://osu.ppy.sh/beatmapsets/${item.beatmap.beatmapset_id
                        }#osu/${item.beatmap.id
                        }|${item.beatmap.beatmapset.title
                        } - ${item.beatmap.beatmapset.artist
                        } (${item.beatmap.difficulty_rating
                        })>
                    
*Ruleset:* ${ruleset}
*Required mods:* ${item.required_mods.length === 0 ? "None" : item.required_mods.map((mod: any) =>
                            // @ts-ignore I HATE THIS
                            Mods[mod.acronym] || mod.acronym
                        ).join(', ')}`
                },
                accessory: {
                    type: "image",
                    image_url: dailyChallenge.host.avatar_url,
                    alt_text: `${dailyChallenge.host.username}'s osu! profile picture`
                }
            },
            {
                type: 'actions',
                elements: [
                    {
                        type: 'button',
                        action_id: 'noop',
                        url: 'osu://room/' + dailyChallenge.id,
                        text: {
                            type: 'plain_text',
                            text: 'Open in osu!lazer'
                        }
                    }
                ]
            }
        ]
    })
}, { timezone: 'UTC' });