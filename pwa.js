(() => {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !("MSStream" in window);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.className = "pwa-install";
  installButton.textContent = isStandalone ? "App installed" : "Install app";
  installButton.setAttribute("aria-label", "Install AirHand on this device");
  installButton.hidden = isStandalone;
  const header = document.querySelector(".top");
  const privacy = header?.querySelector(".privacy");
  if (header && privacy) header.insertBefore(installButton, privacy);

  let installPrompt = null;
  let toastTimer = null;

  function showMessage(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if (!isStandalone) {
      installButton.hidden = false;
      installButton.textContent = "Install app";
    }
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
    showMessage("AirHand was added to your apps.");
  });

  installButton.addEventListener("click", async () => {
    if (isStandalone) return;
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === "accepted") installButton.hidden = true;
      installPrompt = null;
      return;
    }
    if (isIOS) {
      showMessage("To install AirHand, tap Share in Safari, then choose Add to Home Screen.");
      return;
    }
    showMessage("Open this site in a supported browser, then use its Install app or Add to Home Screen option.");
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(registration => {
          registration.update().catch(() => {});
        })
        .catch(error => console.warn("AirHand offline support could not start:", error));
    });
  }

  window.addEventListener("offline", () => {
    showMessage("You are offline. The app shell is saved, but camera tracking needs its online hand model.");
  });
})();
