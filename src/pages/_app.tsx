import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SessionProvider } from "next-auth/react";
import { SyncProvider } from "@/components/SyncProvider";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SessionProvider session={pageProps.session}>
      <SyncProvider>
        <Component {...pageProps} />
      </SyncProvider>
    </SessionProvider>
  );
}
