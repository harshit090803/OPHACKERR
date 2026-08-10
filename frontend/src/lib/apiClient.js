import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE}/api`;

export const api = axios.create({ baseURL: API });

export const uploadPdf = async (file) => {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
};

export const listDocuments = async () => (await api.get("/documents")).data;
export const getDocument = async (id) => (await api.get(`/documents/${id}`)).data;
export const deleteDocument = async (id) => (await api.delete(`/documents/${id}`)).data;
export const regenerateDocument = async (id) => (await api.post(`/documents/${id}/regenerate`)).data;

export const getChat = async (id) => (await api.get(`/documents/${id}/chat`)).data;
export const sendChat = async (id, message) => (await api.post(`/documents/${id}/chat`, { message })).data;
export const clearChat = async (id) => (await api.delete(`/documents/${id}/chat`)).data;

export const getLesson = async (id) => (await api.get(`/documents/${id}/lesson`)).data;
export const regenerateLesson = async (id) => (await api.post(`/documents/${id}/lesson/regenerate`)).data;
export const tts = async (text) => (await api.post(`/tts`, { text })).data;
export const stt = async (blob) => {
  const form = new FormData();
  form.append("file", blob, "voice.webm");
  const { data } = await api.post(`/stt`, form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
};
export const voiceAsk = async (id, text) => (await api.post(`/documents/${id}/voice-ask`, { text })).data;
