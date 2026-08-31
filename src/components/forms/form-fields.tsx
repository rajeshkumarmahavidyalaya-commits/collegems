"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BaseFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  description?: string;
  required?: boolean;
  className?: string;
};

export function TextField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  className,
  type = "text",
  autoComplete,
  placeholder,
}: BaseFieldProps<TFieldValues> & {
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && <span aria-hidden="true" className="text-destructive"> *</span>}
          </FormLabel>
          <FormControl>
            <Input
              type={type}
              autoComplete={autoComplete}
              placeholder={placeholder}
              {...field}
              value={field.value ?? ""}
              onChange={
                type === "number"
                  ? (e) =>
                      field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                  : field.onChange
              }
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextareaField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  className,
  placeholder,
}: BaseFieldProps<TFieldValues> & { placeholder?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && <span aria-hidden="true" className="text-destructive"> *</span>}
          </FormLabel>
          <FormControl>
            <Textarea placeholder={placeholder} {...field} value={field.value ?? ""} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  className,
  placeholder = "Select…",
  options,
}: BaseFieldProps<TFieldValues> & {
  placeholder?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && <span aria-hidden="true" className="text-destructive"> *</span>}
          </FormLabel>
          <Select onValueChange={field.onChange} value={field.value ?? undefined}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
