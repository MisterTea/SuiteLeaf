import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "@supermail/styles/globals.css";

/** SuiteMail's App renders an <Outlet/>, so it must sit under its router. */
export default function SuperMailEmbedded() {
  return <RouterProvider router={router} />;
}
