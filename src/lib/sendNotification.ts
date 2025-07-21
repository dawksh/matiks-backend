import axios from "axios";

export const sendNotification = async (tokens: string[], title: string, body: string, url: string) => {

    await axios.post(url,  {
        notificationId: crypto.randomUUID(),
        title,
        body,
        targetUrl: "https://formula-game.vercel.app",
        tokens
    });

}