import { searchYouTube } from "./music/search.js";

const video = await searchYouTube("this position");
console.log(video);
