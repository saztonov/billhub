import { Grid } from 'antd'

/** Определяет мобильный экран (< 768px, breakpoint md) */
const useIsMobile = (): boolean => {
  const screens = Grid.useBreakpoint()
  return !screens.md
}

export default useIsMobile
