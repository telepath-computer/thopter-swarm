-- Neovim options for thopter dev environments

-- OSC 52 clipboard: lets neovim yank/paste reach the host system clipboard
-- over SSH and tmux. The osc52 module is built into neovim 0.10+ but must be
-- explicitly configured. The terminal escape sequence travels through
-- tmux -> SSH -> iTerm, which sets the local macOS clipboard.
vim.opt.clipboard = "unnamedplus"

vim.g.clipboard = {
  name = "OSC 52",
  copy = {
    ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
    ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
  },
  paste = {
    ["+"] = require("vim.ui.clipboard.osc52").paste("+"),
    ["*"] = require("vim.ui.clipboard.osc52").paste("*"),
  },
}
