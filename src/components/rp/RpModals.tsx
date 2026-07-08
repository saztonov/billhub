import CreateRpModal from '@/components/rp/CreateRpModal'
import CreateRpLetterModal from '@/components/rp/CreateRpLetterModal'
import EditRpLetterModal from '@/components/rp/EditRpLetterModal'
import RpFilesModal from '@/components/rp/RpFilesModal'
import type { RpCombo } from '@/components/rp/CreateRpModal'
import type { PaymentRequest, RpDocumentRef, RpLetter, ConstructionSite } from '@/types'

export interface RpModalsProps {
  // Шаг 1: документы
  createOpen: boolean
  createCombo: RpCombo | null
  requestIds: string[]
  onCreateClose: () => void
  onNext: (documents: RpDocumentRef[]) => void
  // Шаг 2: форма письма PayHub
  letterOpen: boolean
  letterDocs: RpDocumentRef[]
  selectedRequests: PaymentRequest[]
  comboSite: ConstructionSite | undefined
  onLetterClose: () => void
  onCreated: () => void
  // Правка письма из реестра
  editLetter: RpLetter | null
  onEditClose: () => void
  onEditSaved: () => void
  // Файлы РП
  filesLetter: RpLetter | null
  onFilesClose: () => void
  /** Управление файлами РП (admin / назначенец РП); при false модалка файлов read-only. */
  canManageFiles: boolean
}

/** Кластер модалок РП (создание в 2 шага, правка письма, файлы) на странице заявок. */
const RpModals = (props: RpModalsProps) => (
  <>
    <CreateRpModal
      open={props.createOpen}
      combo={props.createCombo}
      requestIds={props.requestIds}
      onClose={props.onCreateClose}
      onNext={props.onNext}
    />

    <CreateRpLetterModal
      open={props.letterOpen}
      combo={props.createCombo}
      requestIds={props.requestIds}
      documents={props.letterDocs}
      selectedRequests={props.selectedRequests}
      site={props.comboSite}
      onClose={props.onLetterClose}
      onCreated={props.onCreated}
    />

    <EditRpLetterModal
      open={!!props.editLetter}
      letter={props.editLetter}
      onClose={props.onEditClose}
      onSaved={props.onEditSaved}
    />

    <RpFilesModal
      open={!!props.filesLetter}
      letter={props.filesLetter}
      canManage={props.canManageFiles}
      onClose={props.onFilesClose}
    />
  </>
)

export default RpModals
