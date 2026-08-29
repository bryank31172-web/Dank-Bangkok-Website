self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  if (data.type === "accepted") {
    event.waitUntil(self.registration.getNotifications({ tag: data.tag }).then((items) => Promise.all(items.map((n) => n.close()))));
    return;
  }
  const options = {
    body: data.body || "New order",
    tag: data.tag || ("dank-order-" + (data.orderId || Date.now())),
    data: { url: data.url || "/staff.html#orders", orderId: data.orderId || "" },
    icon: "/apple-touch-icon.png",
    badge: "/favicon.ico",
    requireInteraction: data.requireInteraction !== false,
    renotify: true,
    vibrate: [250, 120, 250, 120, 400],
    actions: [{ action: "open", title: "Open order" }],
  };
  event.waitUntil(self.registration.showNotification(data.title || "DANK BKK · New order", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/staff.html#orders";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ("focus" in client) { client.navigate(url); return client.focus(); }
    }
    return clients.openWindow(url);
  }));
});
