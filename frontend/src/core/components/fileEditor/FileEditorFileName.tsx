import React from 'react';
import { PDFoxFileStub } from '@app/types/fileContext';
import { PrivateContent } from '@app/components/shared/PrivateContent';

interface FileEditorFileNameProps {
  file: PDFoxFileStub;
}

const FileEditorFileName = ({ file }: FileEditorFileNameProps) => (
  <PrivateContent>{file.name}</PrivateContent>
);

export default FileEditorFileName;
