#
brew install doctl

# create a PAT via API page on admin gui

#
doctl auth init --context thopters

doctl auth switch --context thopters

doctl compute droplet list


