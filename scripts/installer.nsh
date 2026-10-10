; ══════════════════════════════════════════════════════════
;  安装器定制：让 engine（后端 + 便携 Python + 4.6 GB 模型）在升级/卸载时不受损
;
;  背景：
;    electron-builder 生成的卸载流程最后会 `RMDir /r $INSTDIR`
;    （见 app-builder-lib/templates/nsis/uninstaller.nsh），把整个安装目录递归删掉。
;    而 engine 里放着便携 Python（约 2–3 GB）与语音模型（约 4.6 GB），
;    每次升级都会连同模型一起被删除，用户必须重下。
;
;  两道防线：
;    ① 应用侧（main.js 的 ensureEnginePersistent）：Linux/Windows 的目录联接
;       —— engine 的真实位置在安装目录之外（%LOCALAPPDATA%\VoxWorkstation\engine），
;       安装目录里的 engine 只是个联接。删除联接不会跟随到目标，所以数据天然安全。
;    ② 安装器侧（本脚本）：升级时若 engine 仍是实体目录（老版本留下的），
;       先把它改名到安装目录的兄弟目录暂存，等新文件装完再放回；
;       卸载时若 engine 是联接，只删联接本身（且必须不带 /S，否则会跟随进去删掉模型）。
;
;  挂钩：customHeader / customRemoveFiles / customInstall / customUnInstall
;        均为 electron-builder 官方支持的宏。
;  注意：NSIS 不允许宏里定义宏，功能宏一律写在顶层。
; ══════════════════════════════════════════════════════════

!macro customHeader
  ; 暂存位置：安装目录的兄弟目录，保证同盘（Rename 才能瞬时完成）
  !define VOX_ENGINE_KEEP "$INSTDIR\..\VoxWorkstation-engine-keep"
  ; FILE_ATTRIBUTE_REPARSE_POINT = 0x400，目录联接/符号链接都带这个标志
  !define VOX_REPARSE_POINT 0x400
!macroend

!macro VOX_ENGINE_STASH
  IfFileExists "$INSTDIR\engine\*.*" 0 vox_stash_done
    IfFileExists "${VOX_ENGINE_KEEP}\*.*" 0 vox_stash_go
      RMDir /r "${VOX_ENGINE_KEEP}"
    vox_stash_go:
    ClearErrors
    Rename "$INSTDIR\engine" "${VOX_ENGINE_KEEP}"
    IfErrors 0 vox_stash_done
      DetailPrint "engine 改名失败，改用复制方式暂存..."
      CreateDirectory "${VOX_ENGINE_KEEP}"
      CopyFiles /SILENT "$INSTDIR\engine\*.*" "${VOX_ENGINE_KEEP}"
      RMDir /r "$INSTDIR\engine"
  vox_stash_done:
!macroend

!macro VOX_ENGINE_UNSTASH
  IfFileExists "${VOX_ENGINE_KEEP}\*.*" 0 vox_unstash_done
    IfFileExists "$INSTDIR\engine\*.*" 0 vox_unstash_go
      RMDir /r "${VOX_ENGINE_KEEP}"
      Goto vox_unstash_done
    vox_unstash_go:
    ClearErrors
    Rename "${VOX_ENGINE_KEEP}" "$INSTDIR\engine"
    IfErrors 0 vox_unstash_done
      DetailPrint "engine 改回原位失败，改用复制..."
      CreateDirectory "$INSTDIR\engine"
      CopyFiles /SILENT "${VOX_ENGINE_KEEP}\*.*" "$INSTDIR\engine"
      RMDir /r "${VOX_ENGINE_KEEP}"
  vox_unstash_done:
!macroend

; ── 删除安装目录文件的那一步（卸载器内执行）──
!macro customRemoveFiles
  ; 升级路径：engine 若是实体目录，先挪出安装目录，装完再放回
  ${if} ${isUpdated}
    !insertmacro VOX_ENGINE_STASH
  ${endif}

  ; engine 若是联接，只删联接本身。
  ; 注意这里**不能**用 /r —— 递归会跟随联接进目标目录，把真实模型一起删掉。
  nsExec::Exec 'cmd /c rmdir "$INSTDIR\engine"'

  RMDir /r $INSTDIR
!macroend

; ── 主程序装完后，把升级时暂存的 engine 放回 ──
!macro customInstall
  !insertmacro VOX_ENGINE_UNSTASH
!macroend

; ── 卸载收尾 ──
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; 普通卸载：联接本身已在上一步删除，真实数据留在安装目录外
    ; （%LOCALAPPDATA%\VoxWorkstation\engine），供用户主动清理或下次安装复用。
    ; 若还有暂存目录（异常中断留下的），一并清掉。
    IfFileExists "${VOX_ENGINE_KEEP}\*.*" 0 vox_cleanup_done
      RMDir /r "${VOX_ENGINE_KEEP}"
    vox_cleanup_done:
  ${endif}
!macroend
