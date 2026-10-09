import { redirect } from "next/navigation";

/** Vecchio indirizzo del wizard di import (link e segnalibri): ora sta sotto /corsi. */
export default function AddRedirect() {
  redirect("/corsi/add");
}
