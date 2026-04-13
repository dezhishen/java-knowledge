window.addEventListener("load", function () {
  if (!window.mermaid) {
    return;
  }

  window.mermaid.initialize({
    startOnLoad: true,
    securityLevel: "loose",
    theme: "default"
  });
});
