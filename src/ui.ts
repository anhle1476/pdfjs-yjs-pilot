export function createSidebar(options: {
  onDraw: () => void;
  onText: () => void;
  onHighlight: () => void;
  onClear: () => void;
}): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const title = document.createElement("h2");
  title.textContent = "Tools";
  sidebar.appendChild(title);

  const tools = [
    { id: "draw", label: "Draw", handler: options.onDraw },
    { id: "text", label: "Text", handler: options.onText },
    { id: "highlight", label: "Highlight", handler: options.onHighlight },
    { id: "clear", label: "Clear", handler: options.onClear, isClear: true },
  ];

  tools.forEach((tool) => {
    const button = document.createElement("button");
    button.textContent = tool.label;
    button.className = `tool-btn${tool.isClear ? " clear-btn" : ""}`;
    button.dataset.tool = tool.id;
    button.addEventListener("click", () => {
      tool.handler();
      setActiveTool(tool.id);
    });
    sidebar.appendChild(button);
  });
}

export function setActiveTool(tool: string | null): void {
  const buttons = document.querySelectorAll(".tool-btn");
  buttons.forEach((btn) => {
    const button = btn as HTMLButtonElement;
    if (button.dataset.tool === tool) {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  });
}