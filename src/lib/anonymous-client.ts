const CLIENT_KEY = "blinkroom_participant";
/** Random local identifier only. It is hashed before analytics persistence. */
export function anonymousClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(CLIENT_KEY, id); }
  return id;
}
