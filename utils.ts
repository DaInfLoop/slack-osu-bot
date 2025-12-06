import sql from "./postgres";
let _token = ""; // Holds the value of the current "temporary token".

export async function getTemporaryToken(): Promise<string> {
    if (_token) return _token;

    const data = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=${process.env.OSU_CLIENT_ID}&client_secret=${encodeURIComponent(process.env.OSU_CLIENT_SECRET!)}&grant_type=client_credentials&scope=public`
    }).then(res => res.json()) as { token_type: 'Bearer', expires_in: number, access_token: string };

    _token = data.access_token;

    setTimeout(() => {
        _token = "";
    }, data.expires_in)

    return data.access_token;
}

export async function getAccessToken(slack_id: string): Promise<string | null> {
    const user = await sql`SELECT * FROM links WHERE slack_id = ${slack_id}`;

    if (!user[0]) return null

    try {
        const data = await fetch("https://osu.ppy.sh/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${process.env.OSU_CLIENT_ID}&client_secret=${encodeURIComponent(process.env.OSU_CLIENT_SECRET!)}&grant_type=refresh_token&refresh_token=${user[0].refresh_token}&scope=public`
        }).then(res => res.json()) as { token_type: 'Bearer', expires_in: number, access_token: string, refresh_token: string };

        await sql`UPDATE links SET refresh_token = ${data.refresh_token} WHERE slack_id = ${slack_id}`;

        return data.access_token;
    } catch (err) {
        console.error(err)
        return null
    }
}

export async function sendGET<T>(path: string, token?: string): Promise<T> {
    const _token = token || await getTemporaryToken();

    const data = await fetch(`https://osu.ppy.sh/api/v2/${path.replace(/^\/+/, '')}`, {
        headers: {
            'Authorization': `Bearer ${_token}`
        }
    }).then(res => res.json());

    return data as T
}

export enum Mods {
    EZ = "Easy",
    NF = "No Fail",
    HT = "Half Time",
    HR = "Hard Rock",
    SD = "Sudden Death",
    PF = "Perfect",
    DT = "Double Time",
    NC = "Nightcore",
    HD = "Hidden",
    FI = "Fade In",
    FL = "Flashlight",
    RL = "Relax",
    AP = "Autopilot",
    SO = "Spun Out",
    "1K" = "One Key",
    "2K" = "Two Keys",
    "3K" = "Three Keys",
    "4K" = "Four Keys",
    "5K" = "Five Keys",
    "6K" = "Six Keys",
    "7K" = "Seven Keys",
    "8K" = "Eight Keys",
    "9K" = "Nine Keys",
    "10K" = "Ten Keys"
}

// live laugh love stackoverflow :D
export function countryCodeToFlag(countryCode?: string) {
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