import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth";

export default function Home() {
  const user = getServerUser();
  if (user) redirect("/chat");
  redirect("/login");
}
