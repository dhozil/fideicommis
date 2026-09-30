import type { NextConfig } from "next";

const config: NextConfig = {
  // genlayer-js and the GenLayer node are only needed on the server, so nothing
  // from them reaches a client bundle. This app never signs: there is no private
  // key anywhere in web/, and `server-only` on the reader module makes importing
  // it from a client component a build error rather than a review comment.
  serverExternalPackages: ["genlayer-js"],
};

export default config;
