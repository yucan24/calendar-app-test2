export function getMenuPath(role: "admin" | "user") {
  return role === "admin" ? "/admin" : "/user";
}
