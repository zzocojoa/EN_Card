import { type ReactElement } from 'react';
import { cardSchema } from '../../shared/model';
import { api, upload } from '../api';
import { downloadBlob } from '../canvas';
import { pngBlob } from '../canvas';
import { renderCard } from '../canvas';
import { validateBackup } from '../canvas';
import { Icon } from '../ui';
import { TextField } from '../ui';
import { TextAreaField } from '../ui';
import { useStudio } from '../studio';
import { endpoint } from '../environment';
export function EditorPage(): ReactElement | null {
  const {
    fieldErrors,
    savedAsset,
    addToSchedule,
    dirty,
    setDirty,
    setSavedAsset,
    previewExpanded,
    setPreviewExpanded,
    state,
    busy,
    setNotice,
    card,
    editing,
    setEditing,
    restored,
    setRestored,
    reviewed,
    setReviewed,
    cardNumber,
    previewPending,
    previewError,
    preview,
    refresh,
    perform,
    change,
    save,
    setPage,
  } = useStudio();
  if (!state) return null;
  return (
    <>
      <div className="editor-automation-link">
        <span>매일 새 표현을 받아보고 싶다면</span>
        <button className="text-button" disabled={busy} onClick={() => setPage('automation')}>
          AI 자동 제작 <Icon name="arrow" />
        </button>
      </div>
      <div className="workflow-progress" aria-label="카드 준비 단계">
        <span className="active">01 내용 입력</span>
        <span className={reviewed ? 'active' : ''}>02 미리보기·검토</span>
        <span className={savedAsset ? 'active' : ''}>03 저장·예약</span>
      </div>
      <div className="editor-grid">
        <section className="editor-panel">
          <div className="panel-heading">
            <h2>표현 편집</h2>
            <span className="tiny">
              {dirty ? '저장하지 않은 변경' : editing ? `수정본 ${editing.revision}` : '새 카드'}
            </span>
          </div>
          <fieldset disabled={busy}>
            <legend className="sr-only">카드 내용</legend>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={card.template === 'expression'}
                className={card.template === 'expression' ? 'active' : ''}
                onClick={() => change('template', 'expression')}
              >
                표현형
              </button>
              <button
                type="button"
                className={card.template === 'comparison' ? 'active' : ''}
                aria-pressed={card.template === 'comparison'}
                onClick={() => change('template', 'comparison')}
              >
                비교형
              </button>
            </div>
            {card.template === 'comparison' ? (
              <div className="base-fields">
                <TextField
                  label="기본 영어 표현"
                  value={card.base_expression ?? ''}
                  error={fieldErrors.base_expression}
                  required
                  onChange={(value) => change('base_expression', value)}
                />
                <TextField
                  label="기본 표현의 뜻"
                  value={card.base_meaning_ko ?? ''}
                  error={fieldErrors.base_meaning_ko}
                  required
                  onChange={(value) => change('base_meaning_ko', value)}
                />
              </div>
            ) : null}
            <TextField
              label="영어 표현"
              value={card.expression}
              error={fieldErrors.expression}
              required
              onChange={(value) => change('expression', value)}
            />
            <TextField
              label="한글 뜻"
              value={card.meaning_ko}
              error={fieldErrors.meaning_ko}
              required
              onChange={(value) => change('meaning_ko', value)}
            />
            <TextAreaField
              label="영어 예문"
              value={card.example_en}
              error={fieldErrors.example_en}
              required
              onChange={(value) => change('example_en', value)}
            />
            <TextAreaField
              label="예문 번역"
              value={card.example_ko}
              error={fieldErrors.example_ko}
              required
              onChange={(value) => change('example_ko', value)}
            />
            <details>
              <summary>
                발음과 메모 추가 <span>선택</span>
              </summary>
              <TextField
                label="한글식 발음 (참고용)"
                value={card.pronunciation_ko ?? ''}
                error={fieldErrors.pronunciation_ko}
                onChange={(value) => change('pronunciation_ko', value)}
              />
              <TextAreaField
                label="추가 설명"
                value={card.note_ko ?? ''}
                error={fieldErrors.note_ko}
                onChange={(value) => change('note_ko', value)}
              />
              <div className="two-col">
                <TextField
                  label="분류"
                  value={card.category ?? ''}
                  error={fieldErrors.category}
                  onChange={(value) => change('category', value)}
                />
                <TextField
                  label="수준"
                  value={card.level ?? ''}
                  error={fieldErrors.level}
                  onChange={(value) => change('level', value)}
                />
              </div>
            </details>
            <label className="check-row review-check">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={previewPending || Boolean(previewError)}
                onChange={(event) => {
                  setReviewed(event.target.checked);
                  if (!event.target.checked) setSavedAsset(null);
                }}
              />
              <span>내용과 미리보기를 직접 검토했습니다.</span>
            </label>
            <button
              className="primary wide"
              disabled={Boolean(previewError) || previewPending || busy}
              onClick={() => void perform(save)}
            >
              {busy ? '저장 중…' : reviewed ? 'PNG 저장·검토 완료' : 'PNG와 초안 저장'}
              <Icon name="arrow" />
            </button>
            {savedAsset && (
              <div className="save-next" role="status">
                <strong>예약할 준비가 됐어요.</strong>
                <button
                  className="primary wide"
                  disabled={busy}
                  onClick={() => addToSchedule(savedAsset, card.expression)}
                >
                  이 카드 예약하기 <Icon name="arrow" />
                </button>
              </div>
            )}
            <p className="help">이미지 URL을 아는 사람은 학습 카드를 볼 수 있습니다.</p>
            {editing ? (
              <details>
                <summary>PNG 백업 복원</summary>
                <p className="help">
                  현재 카드와 동일한 내용의 1080×1080 PNG를 선택하고 미리보기를 검토하세요. 새
                  이미지는 별도 URL로 저장됩니다.
                </p>
                <input
                  aria-label="PNG 백업 파일"
                  type="file"
                  accept="image/png"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void perform(async () => {
                        await validateBackup(file);
                        setSavedAsset(null);
                        setDirty(true);
                        const saved = (await api(
                          `/api/cards/${editing.id}`,
                          'PUT',
                          { revision: editing.revision, content: cardSchema.parse(card) },
                          state.csrf,
                        )) as { id: string; revision: number };
                        setEditing(saved);
                        const asset = await upload(saved.id, saved.revision, file, state.csrf);
                        await refresh();
                        setRestored({ id: asset.id, public_id: asset.public_id });
                        setReviewed(false);
                        setNotice({
                          kind: 'success',
                          text: 'PNG를 복원했습니다. 미리보기와 내용을 확인한 뒤 검토 완료를 눌러주세요.',
                        });
                      });
                  }}
                />
              </details>
            ) : null}
          </fieldset>
        </section>
        <section className={`preview-panel ${previewExpanded ? 'expanded' : ''}`}>
          <button
            className="secondary preview-toggle"
            aria-expanded={previewExpanded}
            aria-controls="card-preview-content"
            onClick={() => setPreviewExpanded(!previewExpanded)}
          >
            {previewExpanded ? '미리보기 접기' : '미리보기 펼치기'}
          </button>
          <div id="card-preview-content" className="preview-content">
            <div className="panel-heading">
              <h2>카드 미리보기</h2>
              <span className="tiny">1080 × 1080 · PNG</span>
            </div>
            <div className="preview-mat">
              <div
                className="preview-paper"
                aria-busy={previewPending}
                ref={preview}
                role="img"
                aria-label={`${card.expression} 카드 미리보기`}
              />
              {previewError ? (
                <div role="alert" className="preview-error">
                  {previewError}
                </div>
              ) : null}
            </div>
            <div className="preview-footer">
              <span>지금 보이는 그대로 저장됩니다.</span>
              <button
                className="secondary"
                disabled={busy || previewPending || Boolean(previewError)}
                onClick={() =>
                  void perform(async () => {
                    if (restored) {
                      const response = await fetch(endpoint(`/images/${restored.public_id}.png`));
                      if (!response.ok)
                        throw new Error('복원한 PNG를 내려받지 못했습니다. 다시 시도하세요.');
                      downloadBlob(await response.blob(), 'english-card.png');
                    } else
                      downloadBlob(
                        await pngBlob(await renderCard(card, cardNumber)),
                        'english-card.png',
                      );
                  })
                }
              >
                PNG 다운로드 ↓
              </button>
            </div>
            <div className="tip">
              <span>작은 학습 팁</span>
              <p>
                예문을 나의 이야기로 바꿔 보세요.
                <br />
                표현이 조금 더 오래 기억됩니다.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
