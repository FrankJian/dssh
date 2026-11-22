if [ -z "${ZSH_VERSION-}" ]; then
  builtin printf '\033]133;DuoSshIntegration;unsupported\007'
elif [ "${__duossh_co_installed-}" = zsh ]; then
  builtin printf '\033]133;DuoSshIntegration;ready\007'
elif [[ ${parameters[precmd_functions]-} = *readonly* || ${parameters[preexec_functions]-} = *readonly* || ${parameters[PROMPT]-} = *readonly* || ${parameters[PROMPT_EOL_MARK]-} = *readonly* ]] || (( ${+functions[__duossh_co_before]} || ${+functions[__duossh_co_after]} || ${+functions[__duossh_co_start]} )); then
  builtin printf '\033]133;DuoSshIntegration;conflict\007'
else
  typeset -g __duossh_co_installed=zsh __duossh_co_running=0
  typeset -g __duossh_co_prefix=$'%{\e]133;A\a%}' __duossh_co_suffix=$'%{\e]133;B\a%}'
  __duossh_co_before() {
    local __duossh_co_status=$?
    emulate -L zsh
    if [[ $__duossh_co_running = 1 ]]; then builtin printf '\033]133;D;%s\007' "$__duossh_co_status"; fi
    __duossh_co_running=0
    return $__duossh_co_status
  }
  __duossh_co_after() {
    local __duossh_co_status=$?
    emulate -L zsh
    if [[ "$PROMPT" = "$__duossh_co_prefix"*"$__duossh_co_suffix" ]]; then
      PROMPT=${PROMPT#"$__duossh_co_prefix"}
      PROMPT=${PROMPT%"$__duossh_co_suffix"}
    fi
    PROMPT=$__duossh_co_prefix$PROMPT$__duossh_co_suffix
    return $__duossh_co_status
  }
  __duossh_co_start() {
    emulate -L zsh
    __duossh_co_running=1
    builtin printf '\033]133;C\007'
  }
  PROMPT_EOL_MARK=$'%{\e]133;D;%?\a%}'${PROMPT_EOL_MARK-'%B%S%#%s%b'}
  precmd_functions=(__duossh_co_before "${precmd_functions[@]}" __duossh_co_after)
  preexec_functions=("${preexec_functions[@]}" __duossh_co_start)
  builtin printf '\033]133;DuoSshIntegration;ready\007'
fi
