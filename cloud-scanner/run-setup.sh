#!/usr/bin/env bash
# Wrapper court : fixe le GIST_ID connu et délègue à setup-secrets.sh.
# Usage : bash ~/Documents/Github/Tools/Focus/cloud-scanner/run-setup.sh
export GIST_ID=c6de72364df2484f4224d4614dacd009
exec bash "$(dirname "$0")/setup-secrets.sh"
