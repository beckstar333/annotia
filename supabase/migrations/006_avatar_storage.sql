-- Storage policies for avatar uploads
CREATE POLICY "Avatar public read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Avatar auth upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
CREATE POLICY "Avatar auth update" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');
