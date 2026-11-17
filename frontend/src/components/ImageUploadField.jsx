import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 8 * 1024 * 1024

function ImageUploadField({ id, label, value, onChange, required = false }) {
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)
  const preview = useMemo(() => value ? URL.createObjectURL(value) : '', [value])
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  useEffect(() => {
    if (!preview) return undefined
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  function selectFile(file) {
    if (!file) return
    if (!ACCEPTED_TYPES.has(file.type)) {
      onChange(null)
      if (inputRef.current) inputRef.current.value = ''
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      onChange(null)
      if (inputRef.current) inputRef.current.value = ''
      setError('The image must be 8 MB or smaller.')
      return
    }
    onChange(file)
    setError('')
  }

  function removeFile() {
    onChange(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    selectFile(event.dataTransfer.files?.[0])
  }

  return (
    <div className="image-upload">
      <span className="image-upload__label">
        {label}
        {required && <span className="image-upload__required">Required</span>}
      </span>
      <div className="image-upload__actions">
        <label
          className={`image-upload__picker${isDragging ? ' is-dragging' : ''}${value ? ' has-image' : ''}`}
          htmlFor={id}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {value ? (
            <>
              <img src={preview} alt={`Preview of ${label.toLowerCase()}`} />
              <span className="image-upload__copy">
                <strong>{value.name}</strong>
                <small>Click to change this photo</small>
              </span>
              <span className="image-upload__change">Change</span>
            </>
          ) : (
            <>
              <span className="image-upload__icon"><ImagePlus size={19} aria-hidden="true" /></span>
              <span className="image-upload__copy">
                <strong>Choose a photo</strong>
                <small>or drag and drop it here</small>
              </span>
            </>
          )}
          <input
            ref={inputRef}
            accept="image/jpeg,image/png,image/webp"
            aria-label={label}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={Boolean(error)}
            aria-required={required}
            className="visually-hidden"
            id={id}
            type="file"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        {value && (
          <button className="image-upload__remove" type="button" onClick={removeFile}>
            Remove
          </button>
        )}
      </div>
      <p className="image-upload__hint" id={hintId}>JPEG, PNG, or WebP · up to 8 MB</p>
      {error && <p className="image-upload__error" id={errorId} role="alert">{error}</p>}
    </div>
  )
}

export default ImageUploadField
