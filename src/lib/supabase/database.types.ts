export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_sessions: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_current: boolean
          name: string
          start_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_current?: boolean
          name: string
          start_date: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_current?: boolean
          name?: string
          start_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          attendance_date: string
          created_at: string
          enrolment_id: string
          id: string
          marked_by: string | null
          note: string | null
          period: number
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendance_date: string
          created_at?: string
          enrolment_id: string
          id?: string
          marked_by?: string | null
          note?: string | null
          period?: number
          session_id: string
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendance_date?: string
          created_at?: string
          enrolment_id?: string
          id?: string
          marked_by?: string | null
          note?: string | null
          period?: number
          session_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_enrolment_id_fkey"
            columns: ["enrolment_id"]
            isOneToOne: false
            referencedRelation: "enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          row_id: string
          table_name: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id: string
          table_name: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string
          table_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      book_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      book_issues: {
        Row: {
          book_id: string
          created_at: string
          due_at: string
          fine_amount: number
          id: string
          issued_at: string
          issued_by: string | null
          member_id: string
          returned_at: string | null
          returned_by: string | null
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          book_id: string
          created_at?: string
          due_at: string
          fine_amount?: number
          id?: string
          issued_at?: string
          issued_by?: string | null
          member_id: string
          returned_at?: string | null
          returned_by?: string | null
          session_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          book_id?: string
          created_at?: string
          due_at?: string
          fine_amount?: number
          id?: string
          issued_at?: string
          issued_by?: string | null
          member_id?: string
          returned_at?: string | null
          returned_by?: string | null
          session_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_issues_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_issues_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_issues_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_issues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          author: string
          available_copies: number
          category_id: string | null
          cover_path: string | null
          created_at: string
          edition: string | null
          id: string
          isbn: string | null
          publisher: string | null
          shelf_location: string | null
          tenant_id: string
          title: string
          total_copies: number
          updated_at: string
        }
        Insert: {
          author: string
          available_copies?: number
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          edition?: string | null
          id?: string
          isbn?: string | null
          publisher?: string | null
          shelf_location?: string | null
          tenant_id: string
          title: string
          total_copies?: number
          updated_at?: string
        }
        Update: {
          author?: string
          available_copies?: number
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          edition?: string | null
          id?: string
          isbn?: string | null
          publisher?: string | null
          shelf_location?: string | null
          tenant_id?: string
          title?: string
          total_copies?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "books_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "book_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      class_levels: {
        Row: {
          created_at: string
          id: string
          name: string
          sequence: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sequence: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sequence?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_levels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      class_rooms: {
        Row: {
          capacity: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          created_at: string
          id: string
          kind: string
          next_value: number
          prefix: string
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          next_value?: number
          prefix?: string
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          next_value?: number
          prefix?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      enrolments: {
        Row: {
          created_at: string
          enrolled_at: string
          id: string
          roll_number: string | null
          section_id: string
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enrolled_at?: string
          id?: string
          roll_number?: string | null
          section_id: string
          session_id: string
          status?: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enrolled_at?: string
          id?: string
          roll_number?: string | null
          section_id?: string
          session_id?: string
          status?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrolments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_heads: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_heads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          amount: number
          class_level_id: string
          created_at: string
          fee_head_id: string
          frequency: string
          id: string
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          class_level_id: string
          created_at?: string
          fee_head_id: string
          frequency?: string
          id?: string
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          class_level_id?: string
          created_at?: string
          fee_head_id?: string
          frequency?: string
          id?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_class_level_id_fkey"
            columns: ["class_level_id"]
            isOneToOne: false
            referencedRelation: "class_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_student: {
        Row: {
          can_pickup: boolean
          created_at: string
          guardian_id: string
          id: string
          is_primary: boolean
          relationship: string
          student_id: string
          tenant_id: string
        }
        Insert: {
          can_pickup?: boolean
          created_at?: string
          guardian_id: string
          id?: string
          is_primary?: boolean
          relationship: string
          student_id: string
          tenant_id: string
        }
        Update: {
          can_pickup?: boolean
          created_at?: string
          guardian_id?: string
          id?: string
          is_primary?: boolean
          relationship?: string
          student_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_student_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guardians: {
        Row: {
          created_at: string
          id: string
          occupation: string | null
          person_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          occupation?: string | null
          person_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          occupation?: string | null
          person_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardians_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardians_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          name: string
          note: string | null
          session_id: string
          starts_on: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          name: string
          note?: string | null
          session_id: string
          starts_on: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          note?: string | null
          session_id?: string
          starts_on?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          guardian_id: string | null
          id: string
          invited_by: string | null
          person_id: string | null
          role_id: string
          staff_id: string | null
          status: string
          student_id: string | null
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          guardian_id?: string | null
          id?: string
          invited_by?: string | null
          person_id?: string | null
          role_id: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          guardian_id?: string | null
          id?: string
          invited_by?: string | null
          person_id?: string | null
          role_id?: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount: number
          created_at: string
          description: string
          fee_head_id: string | null
          id: string
          invoice_id: string
          session_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          fee_head_id?: string | null
          id?: string
          invoice_id: string
          session_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          fee_head_id?: string | null
          id?: string
          invoice_id?: string
          session_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["tenant_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_date: string
          id?: string
          invoice_number: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          session_id: string
          status?: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_date?: string
          id?: string
          invoice_number?: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          session_id?: string
          status?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invoices_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          job_type: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          job_type: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          job_type?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          book_issue_id?: string | null
          created_at?: string
          entry_type: string
          id?: string
          invoice_id?: string | null
          method?: string | null
          note?: string | null
          occurred_at?: string
          provider?: string | null
          provider_event_id?: string | null
          receipt_number?: string | null
          recorded_by?: string | null
          reference?: string | null
          reverses_entry_id?: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          book_issue_id?: string | null
          created_at?: string
          entry_type?: string
          id?: string
          invoice_id?: string | null
          method?: string | null
          note?: string | null
          occurred_at?: string
          provider?: string | null
          provider_event_id?: string | null
          receipt_number?: string | null
          recorded_by?: string | null
          reference?: string | null
          reverses_entry_id?: string | null
          session_id?: string
          student_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_book_issue_id_fkey"
            columns: ["tenant_id", "book_issue_id"]
            isOneToOne: false
            referencedRelation: "book_issues"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_invoice_id_fkey"
            columns: ["tenant_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: true
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_student_id_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          max_books: number
          membership_number: string
          staff_id: string | null
          status: string
          student_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          max_books?: number
          membership_number: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          max_books?: number
          membership_number?: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          address: string | null
          attempts: number
          body: string
          channel: string
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          notification_id: string
          read_at: string | null
          recipient_user_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          attempts?: number
          body: string
          channel: string
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id: string
          read_at?: string | null
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id: string
        }
        Update: {
          address?: string | null
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id?: string
          read_at?: string | null
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["tenant_id", "notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "notification_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          event_key: string
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          event_key: string
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          event_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          event_key: string
          id: string
          is_active: boolean
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          event_key: string
          id?: string
          is_active?: boolean
          subject?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          event_key?: string
          id?: string
          is_active?: boolean
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience: Json
          body: string
          created_at: string
          created_by: string | null
          event_key: string
          id: string
          payload: Json
          session_id: string
          subject: string | null
          tenant_id: string
        }
        Insert: {
          audience?: Json
          body: string
          created_at?: string
          created_by?: string | null
          event_key: string
          id?: string
          payload?: Json
          session_id: string
          subject?: string | null
          tenant_id: string
        }
        Update: {
          audience?: Json
          body?: string
          created_at?: string
          created_by?: string | null
          event_key?: string
          id?: string
          payload?: Json
          session_id?: string
          subject?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          expires_at: string | null
          failure_reason: string | null
          id: string
          invoice_id: string | null
          ledger_entry_id: string | null
          payment_url: string | null
          provider: string
          provider_order_id: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          ledger_entry_id?: string | null
          payment_url?: string | null
          provider?: string
          provider_order_id?: string | null
          session_id: string
          status?: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          ledger_entry_id?: string | null
          payment_url?: string | null
          provider?: string
          provider_order_id?: string | null
          session_id?: string
          status?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_invoice_id_fkey"
            columns: ["tenant_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "payment_intents_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_student_id_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "payment_intents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          blood_group: string | null
          city: string | null
          country: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          gender: string | null
          id: string
          last_name: string
          middle_name: string | null
          phone: string | null
          photo_path: string | null
          postal_code: string | null
          state: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          blood_group?: string | null
          city?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name: string
          gender?: string | null
          id?: string
          last_name: string
          middle_name?: string | null
          phone?: string | null
          photo_path?: string | null
          postal_code?: string | null
          state?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          blood_group?: string | null
          city?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
          middle_name?: string | null
          phone?: string | null
          photo_path?: string | null
          postal_code?: string | null
          state?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission_code: string
          role_id: string
          tenant_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_code: string
          role_id: string
          tenant_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_code?: string
          role_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          tenant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          tenant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      section_subjects: {
        Row: {
          created_at: string
          id: string
          section_id: string
          session_id: string
          subject_id: string
          teacher_staff_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          section_id: string
          session_id: string
          subject_id: string
          teacher_staff_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          section_id?: string
          session_id?: string
          subject_id?: string
          teacher_staff_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_subjects_section_id_fkey"
            columns: ["tenant_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "section_subjects_subject_id_fkey"
            columns: ["tenant_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "section_subjects_teacher_fkey"
            columns: ["tenant_id", "teacher_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "section_subjects_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_subjects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          capacity: number
          class_level_id: string
          class_teacher_staff_id: string | null
          created_at: string
          id: string
          name: string
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          class_level_id: string
          class_teacher_staff_id?: string | null
          created_at?: string
          id?: string
          name: string
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          class_level_id?: string
          class_teacher_staff_id?: string | null
          created_at?: string
          id?: string
          name?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_class_level_id_fkey"
            columns: ["class_level_id"]
            isOneToOne: false
            referencedRelation: "class_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_class_teacher_staff_id_fkey"
            columns: ["class_teacher_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          id: string
          key: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          id?: string
          key?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          date_of_joining: string
          department: string | null
          designation: string
          employee_code: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_joining?: string
          department?: string | null
          designation: string
          employee_code: string
          id?: string
          person_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_joining?: string
          department?: string | null
          designation?: string
          employee_code?: string
          id?: string
          person_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          admission_date: string
          admission_number: string
          created_at: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admission_date?: string
          admission_number: string
          created_at?: string
          id?: string
          person_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admission_date?: string
          admission_number?: string
          created_at?: string
          id?: string
          person_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      time_slots: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          is_break: boolean
          kind: string
          label: string | null
          period_number: number
          schedulable: boolean | null
          starts_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          is_break?: boolean
          kind?: string
          label?: string | null
          period_number: number
          starts_at: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          is_break?: boolean
          kind?: string
          label?: string | null
          period_number?: number
          starts_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_entries: {
        Row: {
          class_room_id: string | null
          created_at: string
          id: string
          note: string | null
          section_id: string
          session_id: string
          slot_schedulable: boolean
          subject_id: string
          teacher_staff_id: string | null
          tenant_id: string
          time_slot_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          class_room_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          section_id: string
          session_id: string
          slot_schedulable?: boolean
          subject_id: string
          teacher_staff_id?: string | null
          tenant_id: string
          time_slot_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          class_room_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          section_id?: string
          session_id?: string
          slot_schedulable?: boolean
          subject_id?: string
          teacher_staff_id?: string | null
          tenant_id?: string
          time_slot_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "timetable_entries_assignment_fkey"
            columns: ["tenant_id", "session_id", "section_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "section_subjects"
            referencedColumns: ["tenant_id", "session_id", "section_id", "subject_id"]
          },
          {
            foreignKeyName: "timetable_entries_teacher_fkey"
            columns: ["tenant_id", "teacher_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "timetable_entries_room_fkey"
            columns: ["tenant_id", "class_room_id"]
            isOneToOne: false
            referencedRelation: "class_rooms"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "timetable_entries_slot_fkey"
            columns: ["tenant_id", "time_slot_id", "slot_schedulable"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["tenant_id", "id", "schedulable"]
          },
          {
            foreignKeyName: "timetable_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          guardian_id: string | null
          id: string
          is_active: boolean
          person_id: string | null
          role_id: string
          staff_id: string | null
          student_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          guardian_id?: string | null
          id: string
          is_active?: boolean
          person_id?: string | null
          role_id: string
          staff_id?: string | null
          student_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          guardian_id?: string | null
          id?: string
          is_active?: boolean
          person_id?: string | null
          role_id?: string
          staff_id?: string | null
          student_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      weekends: {
        Row: {
          created_at: string
          id: string
          is_teaching: boolean
          tenant_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_teaching?: boolean
          tenant_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          id?: string
          is_teaching?: boolean
          tenant_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekends_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      academics_is_teaching_day: { Args: { p_date: string }; Returns: boolean }
      admit_student: {
        Args: {
          p_admission_date?: string
          p_admission_number: string
          p_person: Json
          p_roll_number?: string | null
          p_section_id?: string | null
        }
        Returns: {
          admission_date: string
          admission_number: string
          created_at: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "students"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_student: {
        Args: {
          p_admission_date: string
          p_admission_number: string
          p_person: Json
          p_roll_number?: string | null
          p_section_id?: string | null
          p_status: string
          p_student_id: string
        }
        Returns: {
          admission_date: string
          admission_number: string
          created_at: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "students"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_role_code: { Args: never; Returns: string }
      current_session_id: { Args: { p_tenant_id: string }; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      fees_cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_create_payment_intent: {
        Args: { p_amount: number; p_invoice_id?: string; p_student_id: string }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          expires_at: string | null
          failure_reason: string | null
          id: string
          invoice_id: string | null
          ledger_entry_id: string | null
          payment_url: string | null
          provider: string
          provider_order_id: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_intents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_day_book: {
        Args: { p_from: string; p_to: string }
        Returns: {
          admission_number: string
          amount: number
          entry_type: string
          id: string
          is_reversal: boolean
          is_reversed: boolean
          method: string
          note: string
          occurred_at: string
          receipt_number: string
          reference: string
          student_id: string
          student_name: string
        }[]
      }
      fees_generate_invoice: {
        Args: {
          p_due_date: string
          p_fee_head_ids?: string[]
          p_notes?: string
          p_student_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_generate_section_invoices: {
        Args: { p_due_date: string; p_fee_head_ids?: string[]; p_section_id: string }
        Returns: number
      }
      fees_next_document_number: { Args: { p_kind: string }; Returns: string }
      fees_queue_invoice_email: {
        Args: { p_invoice_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          job_type: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_raise_charge: {
        Args: {
          p_amount: number
          p_description: string
          p_due_date: string
          p_fee_head_id?: string
          p_student_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_record_adjustment: {
        Args: {
          p_amount: number
          p_entry_type: string
          p_invoice_id?: string
          p_note: string
          p_student_id: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_record_payment: {
        Args: {
          p_amount: number
          p_invoice_id?: string
          p_method: string
          p_note?: string
          p_occurred_at?: string
          p_provider?: string
          p_provider_event_id?: string
          p_reference?: string
          p_student_id: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_record_refund: {
        Args: {
          p_amount: number
          p_method: string
          p_note?: string
          p_occurred_at?: string
          p_reference?: string
          p_student_id: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_reverse_entry: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_student_balances: {
        Args: {
          p_only_outstanding?: boolean
          p_section_id?: string
          p_student_ids?: string[]
        }
        Returns: {
          admission_number: string
          balance: number
          charged: number
          discounts: number
          fines: number
          full_name: string
          last_payment_at: string
          paid: number
          refunds: number
          roll_number: string
          section_label: string
          student_id: string
          write_offs: number
        }[]
      }
      library_issue_book: {
        Args: { p_book_id: string; p_due_at?: string; p_member_id: string }
        Returns: {
          book_id: string
          created_at: string
          due_at: string
          fine_amount: number
          id: string
          issued_at: string
          issued_by: string | null
          member_id: string
          returned_at: string | null
          returned_by: string | null
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "book_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_attendance: {
        Args: {
          p_date: string
          p_entries: Json
          p_period?: number
          p_section_id: string
        }
        Returns: number
      }
      notify_event_types: {
        Args: never
        Returns: {
          default_channels: string[]
          description: string
          key: string
          name: string
        }[]
      }
      notify_inbox: {
        Args: { p_limit?: number; p_only_unread?: boolean }
        Returns: {
          body: string
          created_at: string
          event_key: string
          event_name: string
          id: string
          notification_id: string
          read_at: string | null
          subject: string | null
        }[]
      }
      notify_mark_all_read: { Args: never; Returns: number }
      notify_render: { Args: { p_payload: Json; p_template: string }; Returns: string }
      notify_resolve_audience: {
        Args: { p_audience: Json; p_tenant_id: string }
        Returns: { user_id: string }[]
      }
      notify_send: {
        Args: {
          p_audience: Json
          p_body: string
          p_channels?: string[]
          p_event_key: string
          p_payload?: Json
          p_subject: string
        }
        Returns: {
          audience: Json
          body: string
          created_at: string
          created_by: string | null
          event_key: string
          id: string
          payload: Json
          session_id: string
          subject: string | null
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notify_outbox: {
        Args: { p_event_key?: string; p_limit?: number }
        Returns: {
          audience: Json
          body: string
          created_at: string
          created_by_name: string | null
          deliveries: number
          event_key: string
          event_name: string
          failed: number
          id: string
          queued: number
          recipients: number
          sent: number
          skipped: number
          subject: string | null
        }[]
      }
      notify_unread_count: { Args: never; Returns: number }
      timetable_busy_in_slot: {
        Args: { p_section_id?: string; p_time_slot_id: string; p_weekday: number }
        Returns: {
          busy_with: string
          entity: string
          entity_id: string
        }[]
      }
      timetable_copy_day: {
        Args: { p_from_weekday: number; p_section_id: string; p_to_weekday: number }
        Returns: {
          copied: number
          skipped: number
        }[]
      }
      timetable_describe_entry: { Args: { p_entry_id: string }; Returns: string }
      timetable_for_section: {
        Args: { p_section_id: string }
        Returns: {
          class_room_id: string | null
          ends_at: string
          id: string
          note: string | null
          period_number: number
          room_name: string | null
          slot_label: string | null
          starts_at: string
          subject_code: string
          subject_id: string
          subject_name: string
          teacher_name: string | null
          teacher_staff_id: string | null
          time_slot_id: string
          weekday: number
        }[]
      }
      timetable_for_teacher: {
        Args: { p_staff_id?: string }
        Returns: {
          ends_at: string
          id: string
          period_number: number
          room_name: string | null
          section_id: string
          section_label: string
          starts_at: string
          subject_code: string
          subject_name: string
          time_slot_id: string
          weekday: number
        }[]
      }
      timetable_set_entry: {
        Args: {
          p_class_room_id?: string
          p_note?: string
          p_section_id: string
          p_subject_id: string
          p_teacher_staff_id?: string
          p_time_slot_id: string
          p_weekday: number
        }
        Returns: {
          class_room_id: string | null
          created_at: string
          id: string
          note: string | null
          section_id: string
          session_id: string
          slot_schedulable: boolean
          subject_id: string
          teacher_staff_id: string | null
          tenant_id: string
          time_slot_id: string
          updated_at: string
          weekday: number
        }
        SetofOptions: {
          from: "*"
          to: "timetable_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      timetable_teacher_load: {
        Args: never
        Returns: {
          employee_code: string
          periods: number
          sections: number
          staff_id: string
          subjects: number
          teacher_name: string
        }[]
      }
      schema_guard_violations: {
        Args: never
        Returns: {
          table_name: string
          has_tenant_id: boolean
          rls_enabled: boolean
        }[]
      }
      library_return_book: {
        Args: { p_fine_per_day?: number; p_issue_id: string }
        Returns: {
          book_id: string
          created_at: string
          due_at: string
          fine_amount: number
          id: string
          issued_at: string
          issued_by: string | null
          member_id: string
          returned_at: string | null
          returned_by: string | null
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "book_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
