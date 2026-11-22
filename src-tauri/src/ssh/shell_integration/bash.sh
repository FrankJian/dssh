if [ -z "${BASH_VERSION-}" ]; then
  builtin printf '\033]133;DuoSshIntegration;unsupported\007'
elif [ "${__duossh_co_installed-}" = bash ]; then
  builtin printf '\033]133;DuoSshIntegration;ready\007'
elif [ -n "$(builtin trap -p DEBUG)" ] || [[ $- = *T* ]] || builtin shopt -q extdebug || [ -n "${PS0-}" ] || builtin declare -F __duossh_co_before >/dev/null; then
  builtin printf '\033]133;DuoSshIntegration;conflict\007'
else
  __duossh_co_pc=$(builtin declare -p PROMPT_COMMAND 2>/dev/null)
  __duossh_co_ps=$(builtin declare -p PS1 2>/dev/null)
  __duossh_co_pcflags=${__duossh_co_pc#declare -}
  __duossh_co_p0=$(builtin declare -p PS0 2>/dev/null)
  __duossh_co_p0flags=${__duossh_co_p0#declare -}
  __duossh_co_psflags=${__duossh_co_ps#declare -}
  if [[ ${__duossh_co_pcflags%% *} = *r* || ${__duossh_co_psflags%% *} = *r* || ${__duossh_co_p0flags%% *} = *r* ]]; then
    builtin printf '\033]133;DuoSshIntegration;conflict\007'
  else
    __duossh_co_running=0
    __duossh_co_suppress=1
    __duossh_co_prefix='\[\e]133;A\a\]'
    __duossh_co_suffix='\[\e]133;B\a\]'
    __duossh_co_before() {
      local __duossh_co_status=$?
      __duossh_co_suppress=1
      if [ "$__duossh_co_running" = 1 ]; then builtin printf '\033]133;D;%s\007' "$__duossh_co_status"; fi
      __duossh_co_running=0
      return "$__duossh_co_status"
    }
    __duossh_co_after() {
      local __duossh_co_status=$?
      if [[ "$PS1" = "$__duossh_co_prefix"*"$__duossh_co_suffix" ]]; then
        PS1=${PS1#"$__duossh_co_prefix"}
        PS1=${PS1%"$__duossh_co_suffix"}
      fi
      PS1=$__duossh_co_prefix$PS1$__duossh_co_suffix
      __duossh_co_suppress=0
      return "$__duossh_co_status"
    }
    __duossh_co_start() {
      local __duossh_co_status=$?
      case "$BASH_COMMAND" in __duossh_co_before|__duossh_co_after) return "$__duossh_co_status";; esac
      if [ "$__duossh_co_suppress" = 0 ] && [ "$__duossh_co_running" = 0 ]; then
        __duossh_co_running=1
        builtin printf '\033]133;C\007'
      fi
      return "$__duossh_co_status"
    }
    if [[ "$__duossh_co_pc" = 'declare -a '* ]]; then
      PROMPT_COMMAND=(__duossh_co_before "${PROMPT_COMMAND[@]}" __duossh_co_after)
    else
      PROMPT_COMMAND=$'__duossh_co_before\n'"${PROMPT_COMMAND:-:}"$'\n__duossh_co_after'
    fi
    builtin trap '__duossh_co_start' DEBUG
    __duossh_co_installed=bash
    builtin printf '\033]133;DuoSshIntegration;ready\007'
  fi
fi
